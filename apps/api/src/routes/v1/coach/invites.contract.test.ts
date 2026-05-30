// apps/api/src/routes/v1/coach/invites.contract.test.ts
//
// Contract test for the coach roster-invite send path (Epic #11 /
// Story #920 / Task #925).
//
// Pins the wire shape AND the authorization / state invariants the
// Tech Spec and Task ACs nominate as load-bearing:
//
//   - POST  /api/v1/coach/teams/:teamId/roster/invites
//       · 201 happy path returns the invite row (no plaintext token).
//       · The persisted row carries a SHA-256 of the plaintext token;
//         the plaintext is NEVER in the response body, NEVER in the DB.
//       · Forged extra fields (`role`, `orgId`) are refused at the
//         boundary (`.strict()` rejection → 400 INVALID_BODY).
//       · Cross-team coach gets 404 (no existence oracle).
//       · Mail-transport failure surfaces 502; the row is still
//         persisted so the coach can revoke + re-issue.
//   - GET   /api/v1/coach/teams/:teamId/roster/invites
//       · Returns pending + non-pending invites for the team.
//       · Cross-team coach gets 404.
//   - POST  /api/v1/coach/teams/:teamId/roster/invites/:inviteId/revoke
//       · Pending → revoked transition.
//       · Already-accepted invite refuses with 409 INVITE_NOT_PENDING.
//       · Cross-team coach gets 404.
//
// The harness reuses the `createTestApp` seam from `@repo/shared/
// testing` and mounts only the invites router — every other middleware
// (the `requireCoachOnTeam` predicate, the per-row org scope inside
// the handler) is the real production module.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  coachAssignments,
  organizations,
  rosterInvites,
  teams,
  users,
} from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { type RosterInviteMailTransport, hashToken } from '../../../mailer/rosterInvite';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { coachInvitesRoute } from './invites';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../packages/shared/src/db/migrations');

function freshCoachDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of [
    '0000_auth_and_rbac.sql',
    '0001_onboarding_schema.sql',
    '0002_org_team_graph.sql',
    '0003_invitations.sql',
    '0004_org_branding.sql',
    '0005_team_metadata.sql',
    '0006_csv_import_batches.sql',
    '0007_roster.sql',
    '0008_csv_import_batch_filename.sql',
    '0009_roster_invite_dedup_pending.sql',
  ]) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, {
    schema: { organizations, teams, users, coachAssignments, rosterInvites },
  });
}

type CoachDb = ReturnType<typeof freshCoachDb>;

const ORG_A = 'org_a_test';
const ORG_B = 'org_b_test';

function actor(orgId: string, overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: `u_coach_${orgId}`,
    clerkSubjectId: `user_test_${orgId}`,
    email: `coach-${orgId}@test.invalid`,
    role: 'member',
    orgId,
    teamId: null,
    ...overrides,
  };
}

function seedOrg(db: CoachDb, id: string): void {
  db.insert(organizations)
    .values({ id, name: `Org ${id}`, organizationType: 'CLUB' })
    .onConflictDoNothing()
    .run();
}

function seedTeam(db: CoachDb, orgId: string, id: string): string {
  db.insert(teams)
    .values({
      id,
      orgId,
      name: `Team ${id}`,
      sport: 'Volleyball',
      season: 'Fall 2026',
      ageGroup: 'U14',
    })
    .run();
  return id;
}

function seedUser(db: CoachDb, orgId: string, id: string, email?: string): string {
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email: email ?? `${id}@test.invalid`,
      role: 'member',
      orgId,
      teamId: null,
    })
    .run();
  return id;
}

function seedCoachAssignment(
  db: CoachDb,
  orgId: string,
  teamId: string,
  coachUserId: string,
  opts: { id?: string; endedAt?: Date | null } = {},
): string {
  const id = opts.id ?? `ca_${orgId}_${teamId}_${coachUserId}`;
  db.insert(coachAssignments)
    .values({
      id,
      orgId,
      teamId,
      coachUserId,
      endedAt: opts.endedAt ?? null,
    })
    .run();
  return id;
}

function seedInvite(
  db: CoachDb,
  orgId: string,
  teamId: string,
  invitedByUserId: string,
  opts: {
    id?: string;
    email?: string;
    status?: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
    expiresAt?: Date;
  } = {},
): string {
  const id = opts.id ?? `rinv_${teamId}_${invitedByUserId}`;
  db.insert(rosterInvites)
    .values({
      id,
      orgId,
      teamId,
      email: opts.email ?? `recipient-${id}@test.invalid`,
      firstName: null,
      lastName: null,
      tokenHash: hashToken(`token_${id}`),
      status: opts.status ?? 'pending',
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 86_400_000),
      acceptedAt: null,
      declinedAt: null,
      invitedByUserId,
    })
    .run();
  return id;
}

/** A transport stub that records sent messages — and never throws. */
function recordingTransport(): RosterInviteMailTransport & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    send(message) {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

/** A transport stub that always throws — to exercise the 502 path. */
function failingTransport(): RosterInviteMailTransport {
  return {
    send() {
      return Promise.reject(new Error('Provider unavailable'));
    },
  };
}

function buildApp(db: CoachDb, a: AuthContext, transport: RosterInviteMailTransport | null) {
  const harness = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  if (transport) {
    harness.use('*', async (c, next) => {
      (c as unknown as { set: (k: string, v: unknown) => void }).set(
        'rosterInviteMailTransport',
        transport,
      );
      await next();
    });
  }
  harness.route('/api/v1/coach/teams/:teamId/roster/invites', coachInvitesRoute);
  return harness;
}

const STUB_ENV = { ANALYTICS: { writeDataPoint: () => undefined } };

interface InviteWire {
  readonly id: string;
  readonly teamId: string;
  readonly email: string;
  readonly status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  readonly invitedByUserId: string;
  readonly expiresAt: string;
}

interface CreateBody {
  success: boolean;
  data?: { invite: InviteWire };
  error?: { code: string; message: string };
}

interface ListBody {
  success: boolean;
  data?: { items: InviteWire[] };
  error?: { code: string; message: string };
}

interface RevokeBody {
  success: boolean;
  data?: { invite: InviteWire };
  error?: { code: string; message: string };
}

beforeEach(() => {
  // Each test owns its own DB via `freshCoachDb()`.
});

// ──────────────────────────────────────────────────────────────────────────
// POST — create
// ──────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/coach/teams/:teamId/roster/invites — happy path', () => {
  it('returns 201 with the persisted invite and persists a SHA-256 token hash', async () => {
    // Arrange
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const transport = recordingTransport();

    // Act
    const res = await buildApp(db, coach, transport).request(
      `/api/v1/coach/teams/${team}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Recruit@example.test', firstName: 'Re' }),
      },
      STUB_ENV,
    );

    // Assert — wire shape
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateBody;
    expect(body.success).toBe(true);
    expect(body.data?.invite).toMatchObject({
      teamId: team,
      email: 'recruit@example.test', // lowercased by Zod transform
      status: 'pending',
      invitedByUserId: coach.userId,
    });
    // The response MUST NOT carry the plaintext token.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/token/i);

    // Assert — DB shape: the persisted row has a token_hash (64-char
    // hex) and no plaintext column. The row's email is lowercased.
    const rows = db.select().from(rosterInvites).where(eqInviteEmail('recruit@example.test')).all();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.email).toBe('recruit@example.test');
    expect(row.status).toBe('pending');

    // The transport recorded one message addressed to the recipient.
    expect(transport.sent).toHaveLength(1);
  });

  it('refuses extra fields at the boundary (.strict())', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${team}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'r@x.test', role: 'admin' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as CreateBody;
    expect(body.error?.code).toBe('INVALID_BODY');
  });

  it('returns 503 MAIL_TRANSPORT_UNBOUND when no transport is wired and persists no row', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_unbound');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);

    // `null` → no `rosterInviteMailTransport` var is set on the
    // Hono context, mirroring production wiring that has not bound
    // a provider yet.
    const res = await buildApp(db, coach, null).request(
      `/api/v1/coach/teams/${team}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'r@x.test' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as CreateBody;
    expect(body.error?.code).toBe('MAIL_TRANSPORT_UNBOUND');

    // Fail-closed: no `roster_invite` row was persisted.
    const rows = db.select().from(rosterInvites).all();
    expect(rows).toHaveLength(0);
  });

  it('returns 502 MAIL_SEND_FAILED when the transport throws', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);

    const res = await buildApp(db, coach, failingTransport()).request(
      `/api/v1/coach/teams/${team}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'r@x.test' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as CreateBody;
    expect(body.error?.code).toBe('MAIL_SEND_FAILED');
    // The row IS still persisted so the coach can revoke + re-issue.
    const rows = db.select().from(rosterInvites).all();
    expect(rows).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// POST — dedup pending (Story #1052 / F35)
// ──────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/coach/teams/:teamId/roster/invites — dedup pending', () => {
  it('refuses a second invite for a pending (email, team) pair with 409 INVITE_ALREADY_PENDING and leaves a single pending row', async () => {
    // Arrange — a pending invite already exists for this recipient on
    // this team.
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    seedInvite(db, ORG_A, team, coach.userId, {
      id: 'rinv_existing',
      email: 'dupe@x.test',
      status: 'pending',
    });
    const transport = recordingTransport();

    // Act — the coach sends a second invite to the same email.
    const res = await buildApp(db, coach, transport).request(
      `/api/v1/coach/teams/${team}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'dupe@x.test' }),
      },
      STUB_ENV,
    );

    // Assert — wire shape: 409 INVITE_ALREADY_PENDING.
    expect(res.status).toBe(409);
    const body = (await res.json()) as CreateBody;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INVITE_ALREADY_PENDING');

    // Assert — DB state: exactly one pending row survives; no second
    // row was inserted.
    const pendingRows = db.select().from(rosterInvites).where(eqInvitePending('dupe@x.test')).all();
    expect(pendingRows).toHaveLength(1);

    // No email was dispatched for the refused duplicate.
    expect(transport.sent).toHaveLength(0);
  });

  it('matches on the Zod-lowercased email so a differently-cased resend is still refused', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    // Persisted lowercased — the create path lowercases via the Zod
    // transform.
    seedInvite(db, ORG_A, team, coach.userId, {
      id: 'rinv_lower',
      email: 'mixed@x.test',
      status: 'pending',
    });

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${team}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'Mixed@X.test' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as CreateBody;
    expect(body.error?.code).toBe('INVITE_ALREADY_PENDING');

    const rows = db.select().from(rosterInvites).where(eqInvitePending('mixed@x.test')).all();
    expect(rows).toHaveLength(1);
  });

  it('still allows a fresh invite when the only prior row for the pair is non-pending (revoked)', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    seedInvite(db, ORG_A, team, coach.userId, {
      id: 'rinv_revoked',
      email: 'resend@x.test',
      status: 'revoked',
    });

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${team}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'resend@x.test' }),
      },
      STUB_ENV,
    );

    // The prior row is revoked (not pending), so the dedup probe does
    // not match and the resend succeeds.
    expect(res.status).toBe(201);
    const rows = db.select().from(rosterInvites).where(eqInvitePending('resend@x.test')).all();
    expect(rows).toHaveLength(1);
  });

  it('the partial unique index rejects a second pending row at the persistence layer (race-safe backstop)', () => {
    // Arrange — a pending invite already exists.
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    seedInvite(db, ORG_A, team, coach.userId, {
      id: 'rinv_first',
      email: 'backstop@x.test',
      status: 'pending',
    });

    // Act + Assert — a direct second pending insert for the same
    // (email, team_id) pair (simulating the lost-probe race) is
    // refused by the DB. The partial unique index from migration 0009
    // is the final arbiter even when two concurrent Sends both pass
    // the application-side probe.
    expect(() =>
      seedInvite(db, ORG_A, team, coach.userId, {
        id: 'rinv_second',
        email: 'backstop@x.test',
        status: 'pending',
      }),
    ).toThrow(/UNIQUE/i);

    const rows = db.select().from(rosterInvites).where(eqInvitePending('backstop@x.test')).all();
    expect(rows).toHaveLength(1);
  });
});

describe('POST /api/v1/coach/teams/:teamId/roster/invites — authorization', () => {
  it('returns 404 when the coach is on a different team in the same org', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const teamMine = seedTeam(db, ORG_A, 't_mine');
    const teamOther = seedTeam(db, ORG_A, 't_other');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, teamMine, coach.userId);

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${teamOther}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'r@x.test' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as CreateBody;
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 404 when the coach is on a team in a different org', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamA = seedTeam(db, ORG_A, 't_a');
    const teamB = seedTeam(db, ORG_B, 't_b');
    const coachA = actor(ORG_A);
    seedUser(db, ORG_A, coachA.userId, coachA.email);
    seedCoachAssignment(db, ORG_A, teamA, coachA.userId);

    const res = await buildApp(db, coachA, recordingTransport()).request(
      `/api/v1/coach/teams/${teamB}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'r@x.test' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// GET — list
// ──────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/coach/teams/:teamId/roster/invites — happy path', () => {
  it('returns pending and non-pending invites for the team', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);

    seedInvite(db, ORG_A, team, coach.userId, { id: 'rinv_p', status: 'pending' });
    seedInvite(db, ORG_A, team, coach.userId, { id: 'rinv_r', status: 'revoked' });

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${team}/roster/invites`,
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    expect(body.success).toBe(true);
    const statuses = body.data?.items.map((i) => i.status).sort();
    expect(statuses).toEqual(['pending', 'revoked']);
  });

  it('returns 404 when the coach is on a different team', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const teamMine = seedTeam(db, ORG_A, 't_mine');
    const teamOther = seedTeam(db, ORG_A, 't_other');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, teamMine, coach.userId);

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${teamOther}/roster/invites`,
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// POST — revoke
// ──────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/coach/teams/:teamId/roster/invites/:inviteId/revoke', () => {
  it('transitions a pending invite to status=revoked', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const inviteId = seedInvite(db, ORG_A, team, coach.userId, { status: 'pending' });

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${team}/roster/invites/${inviteId}/revoke`,
      { method: 'POST' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as RevokeBody;
    expect(body.data?.invite.status).toBe('revoked');

    // DB confirms the transition.
    const rows = db.select().from(rosterInvites).all();
    expect(rows[0]?.status).toBe('revoked');
  });

  it('refuses to revoke an already-accepted invite with 409 INVITE_NOT_PENDING', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const inviteId = seedInvite(db, ORG_A, team, coach.userId, { status: 'accepted' });

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${team}/roster/invites/${inviteId}/revoke`,
      { method: 'POST' },
      STUB_ENV,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as RevokeBody;
    expect(body.error?.code).toBe('INVITE_NOT_PENDING');
  });

  it('returns 404 when the invite belongs to a different team', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const teamMine = seedTeam(db, ORG_A, 't_mine');
    const teamOther = seedTeam(db, ORG_A, 't_other');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, teamMine, coach.userId);
    seedCoachAssignment(db, ORG_A, teamOther, coach.userId);
    const inviteId = seedInvite(db, ORG_A, teamMine, coach.userId, {
      id: 'rinv_mine',
      status: 'pending',
    });

    // The coach IS on teamOther — predicate passes — but the invite
    // lives on teamMine, so the team-scoped lookup returns 404.
    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${teamOther}/roster/invites/${inviteId}/revoke`,
      { method: 'POST' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
  });

  it('returns 404 when the coach is on a different team in the same org', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const teamMine = seedTeam(db, ORG_A, 't_mine');
    const teamOther = seedTeam(db, ORG_A, 't_other');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, teamMine, coach.userId);
    const inviteId = seedInvite(db, ORG_A, teamOther, coach.userId, {
      id: 'rinv_other',
      status: 'pending',
    });

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${teamOther}/roster/invites/${inviteId}/revoke`,
      { method: 'POST' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Re-issue after expiry — covered by AC #4 ("re-issue after expiry creates
// a new pending row")
// ──────────────────────────────────────────────────────────────────────────

describe('re-issue after expiry creates a new pending row', () => {
  it('inserts a new row alongside the expired one', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    // An expired row exists for this email.
    seedInvite(db, ORG_A, team, coach.userId, {
      id: 'rinv_old',
      email: 'reissue@x.test',
      status: 'expired',
      expiresAt: new Date(Date.now() - 86_400_000),
    });

    const res = await buildApp(db, coach, recordingTransport()).request(
      `/api/v1/coach/teams/${team}/roster/invites`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'reissue@x.test' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(201);
    const rows = db.select().from(rosterInvites).all();
    // The original (expired) row remains; the new pending row is
    // alongside it.
    expect(rows).toHaveLength(2);
    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['expired', 'pending']);
  });
});

/**
 * Local helper — Drizzle eq predicate against rosterInvites.email,
 * declared as a function so the predicate stays colocated with the
 * tests that consume it.
 */
function eqInviteEmail(email: string) {
  return eq(rosterInvites.email, email);
}

/**
 * Local helper — Drizzle predicate selecting the pending row(s) for a
 * given email. Used by the dedup tests to assert the single-pending
 * post-state.
 */
function eqInvitePending(email: string) {
  return and(eq(rosterInvites.email, email), eq(rosterInvites.status, 'pending'));
}
