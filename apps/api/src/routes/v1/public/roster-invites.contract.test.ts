// apps/api/src/routes/v1/public/roster-invites.contract.test.ts
//
// Contract test for the tokenized public accept / decline handshake
// (Epic #11 / Story #926 / Task #931). Pins the wire shape AND the
// load-bearing security / state invariants nominated by the Tech Spec
// and Task ACs:
//
//   - Accept transitions pending → accepted, inserts athlete_memberships
//     (when absent) and roster_entry in one DB transaction.
//   - Decline transitions pending → declined and creates no roster
//     artefacts.
//   - One-shot: a second accept (or decline) with the same token is
//     refused — the row is no longer pending.
//   - Expired-on-read transition: a pending row past its expiry flips to
//     `expired` on the accept attempt and the request returns 409.
//   - Revoked invite refuses with 409 INVITE_REVOKED.
//   - Token mismatch returns 404 NOT_FOUND (no existence oracle).
//   - The plaintext token NEVER appears in any persisted column —
//     only `token_hash` (SHA-256) is stored.
//
// The harness mounts the public router on a bare Hono app + the `db`
// middleware so the route reads its handle from `c.var.db` exactly as
// it will at runtime. No auth middleware is wired — the route is
// unauthenticated by design.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  athleteMemberships,
  coachAssignments,
  organizations,
  rosterEntries,
  rosterInvites,
  teams,
  users,
} from '@repo/shared/db/schema';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../../mailer/rosterInvite';
import { publicRosterInvitesRoute } from './roster-invites';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../packages/shared/src/db/migrations');

function freshDb() {
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
  ]) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, {
    schema: {
      organizations,
      teams,
      users,
      coachAssignments,
      athleteMemberships,
      rosterEntries,
      rosterInvites,
    },
  });
}

type DbHandle = ReturnType<typeof freshDb>;

const ORG_A = 'org_a_public';

function seedOrg(db: DbHandle, id: string): void {
  db.insert(organizations)
    .values({ id, name: `Org ${id}`, organizationType: 'CLUB' })
    .onConflictDoNothing()
    .run();
}

function seedTeam(db: DbHandle, orgId: string, id: string): string {
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

function seedUser(db: DbHandle, orgId: string, id: string, email: string): string {
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email,
      role: 'member',
      orgId,
      teamId: null,
    })
    .run();
  return id;
}

interface SeedInviteOptions {
  readonly id?: string;
  readonly email?: string;
  readonly status?: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  readonly expiresAt?: Date;
  readonly token?: string;
}

function seedInvite(
  db: DbHandle,
  orgId: string,
  teamId: string,
  invitedByUserId: string,
  opts: SeedInviteOptions = {},
): { id: string; plaintextToken: string; tokenHash: string } {
  const id = opts.id ?? `rinv_public_${teamId}`;
  const plaintextToken = opts.token ?? 'a'.repeat(64); // 64 hex chars
  const tokenHash = hashToken(plaintextToken);
  db.insert(rosterInvites)
    .values({
      id,
      orgId,
      teamId,
      email: opts.email ?? `recipient-${id}@test.invalid`,
      firstName: null,
      lastName: null,
      tokenHash,
      status: opts.status ?? 'pending',
      expiresAt: opts.expiresAt ?? new Date(Date.now() + 7 * 86_400_000),
      acceptedAt: null,
      declinedAt: null,
      invitedByUserId,
    })
    .run();
  return { id, plaintextToken, tokenHash };
}

function buildApp(db: DbHandle) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('db', db);
    await next();
  });
  app.route('/api/v1/public/roster-invites', publicRosterInvitesRoute);
  return app;
}

interface ResponseBody {
  success: boolean;
  data?: { invite: { id: string; teamId: string; status: string } };
  error?: { code: string; message: string };
}

beforeEach(() => {
  // Each test owns its own DB via `freshDb()`.
});

// ── Accept ─────────────────────────────────────────────────────────────────

describe('POST /api/v1/public/roster-invites/:token/accept — happy path', () => {
  it('transitions pending → accepted and creates membership + roster_entry in one TX', async () => {
    // Arrange
    const db = freshDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_public_one');
    const coach = seedUser(db, ORG_A, 'u_coach_public', 'coach-public@test.invalid');
    const athleteEmail = 'recipient-pa@test.invalid';
    seedUser(db, ORG_A, 'u_athlete_public', athleteEmail);
    const invite = seedInvite(db, ORG_A, team, coach, {
      id: 'rinv_accept_happy',
      email: athleteEmail,
      token: 'b'.repeat(64),
    });

    // Act
    const res = await buildApp(db).request(
      `/api/v1/public/roster-invites/${invite.plaintextToken}/accept`,
      { method: 'POST' },
    );

    // Assert — wire shape
    expect(res.status).toBe(200);
    const body = (await res.json()) as ResponseBody;
    expect(body.success).toBe(true);
    expect(body.data?.invite).toMatchObject({ id: invite.id, teamId: team, status: 'accepted' });

    // Assert — invite row transitioned
    const inviteRows = db
      .select()
      .from(rosterInvites)
      .where(eq(rosterInvites.id, invite.id))
      .all();
    expect(inviteRows[0]?.status).toBe('accepted');
    expect(inviteRows[0]?.acceptedAt).toBeInstanceOf(Date);

    // Assert — membership + roster_entry created
    const memberships = db
      .select()
      .from(athleteMemberships)
      .where(eq(athleteMemberships.teamId, team))
      .all();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.athleteUserId).toBe('u_athlete_public');

    const entries = db.select().from(rosterEntries).where(eq(rosterEntries.teamId, team)).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.athleteUserId).toBe('u_athlete_public');
    expect(entries[0]?.endedAt).toBeNull();
  });

  it('is one-shot: a second accept with the same token is refused', async () => {
    const db = freshDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_oneshot');
    const coach = seedUser(db, ORG_A, 'u_coach_os', 'coach-os@test.invalid');
    const athleteEmail = 'recipient-os@test.invalid';
    seedUser(db, ORG_A, 'u_athlete_os', athleteEmail);
    const invite = seedInvite(db, ORG_A, team, coach, {
      id: 'rinv_oneshot',
      email: athleteEmail,
      token: 'c'.repeat(64),
    });

    // First accept succeeds.
    const first = await buildApp(db).request(
      `/api/v1/public/roster-invites/${invite.plaintextToken}/accept`,
      { method: 'POST' },
    );
    expect(first.status).toBe(200);

    // Second accept with the same token refuses.
    const second = await buildApp(db).request(
      `/api/v1/public/roster-invites/${invite.plaintextToken}/accept`,
      { method: 'POST' },
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as ResponseBody;
    expect(body.error?.code).toBe('INVITE_NOT_PENDING');
  });

  it('does not create a roster_entry when the recipient user is missing', async () => {
    const db = freshDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_no_user');
    const coach = seedUser(db, ORG_A, 'u_coach_nu', 'coach-nu@test.invalid');
    // No matching `users` row for the invite email.
    const invite = seedInvite(db, ORG_A, team, coach, {
      id: 'rinv_no_user',
      email: 'orphan@test.invalid',
      token: 'd'.repeat(64),
    });

    const res = await buildApp(db).request(
      `/api/v1/public/roster-invites/${invite.plaintextToken}/accept`,
      { method: 'POST' },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ResponseBody;
    expect(body.error?.code).toBe('RECIPIENT_NOT_FOUND');

    // No roster_entry / membership was created.
    expect(db.select().from(rosterEntries).all()).toHaveLength(0);
    expect(db.select().from(athleteMemberships).all()).toHaveLength(0);
    // Invite remains pending — no partial state.
    const rows = db.select().from(rosterInvites).where(eq(rosterInvites.id, invite.id)).all();
    expect(rows[0]?.status).toBe('pending');
  });
});

describe('POST /api/v1/public/roster-invites/:token/accept — lifecycle guards', () => {
  it('transitions an expired-on-read invite to status=expired and refuses with 409', async () => {
    const db = freshDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_expired');
    const coach = seedUser(db, ORG_A, 'u_coach_exp', 'coach-exp@test.invalid');
    seedUser(db, ORG_A, 'u_athlete_exp', 'recipient-exp@test.invalid');
    const invite = seedInvite(db, ORG_A, team, coach, {
      id: 'rinv_expired',
      email: 'recipient-exp@test.invalid',
      token: 'e'.repeat(64),
      // Past expiry but still status=pending — the route lazy-transitions.
      expiresAt: new Date(Date.now() - 60 * 1000),
    });

    const res = await buildApp(db).request(
      `/api/v1/public/roster-invites/${invite.plaintextToken}/accept`,
      { method: 'POST' },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ResponseBody;
    expect(body.error?.code).toBe('INVITE_EXPIRED');

    // The row is now status=expired.
    const rows = db.select().from(rosterInvites).where(eq(rosterInvites.id, invite.id)).all();
    expect(rows[0]?.status).toBe('expired');
  });

  it('refuses to accept a revoked invite with 409 INVITE_REVOKED', async () => {
    const db = freshDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_revoked');
    const coach = seedUser(db, ORG_A, 'u_coach_rv', 'coach-rv@test.invalid');
    const invite = seedInvite(db, ORG_A, team, coach, {
      id: 'rinv_revoked',
      status: 'revoked',
      token: 'f'.repeat(64),
    });

    const res = await buildApp(db).request(
      `/api/v1/public/roster-invites/${invite.plaintextToken}/accept`,
      { method: 'POST' },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ResponseBody;
    expect(body.error?.code).toBe('INVITE_REVOKED');
  });

  it('returns 404 NOT_FOUND when the token does not match any row', async () => {
    const db = freshDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_404');
    const coach = seedUser(db, ORG_A, 'u_coach_404', 'coach-404@test.invalid');
    seedInvite(db, ORG_A, team, coach, { id: 'rinv_404', token: '1'.repeat(64) });

    const nonMatchingToken = '2'.repeat(64);
    const res = await buildApp(db).request(
      `/api/v1/public/roster-invites/${nonMatchingToken}/accept`,
      { method: 'POST' },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as ResponseBody;
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND for a malformed token shape', async () => {
    const db = freshDb();
    seedOrg(db, ORG_A);
    seedTeam(db, ORG_A, 't_bad_token');

    const res = await buildApp(db).request(
      `/api/v1/public/roster-invites/NOT-A-HEX-TOKEN/accept`,
      { method: 'POST' },
    );
    expect(res.status).toBe(404);
  });
});

// ── Decline ────────────────────────────────────────────────────────────────

describe('POST /api/v1/public/roster-invites/:token/decline', () => {
  it('transitions pending → declined and creates no roster_entry', async () => {
    const db = freshDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_decline');
    const coach = seedUser(db, ORG_A, 'u_coach_dc', 'coach-dc@test.invalid');
    seedUser(db, ORG_A, 'u_athlete_dc', 'recipient-dc@test.invalid');
    const invite = seedInvite(db, ORG_A, team, coach, {
      id: 'rinv_decline',
      email: 'recipient-dc@test.invalid',
      token: '3'.repeat(64),
    });

    const res = await buildApp(db).request(
      `/api/v1/public/roster-invites/${invite.plaintextToken}/decline`,
      { method: 'POST' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ResponseBody;
    expect(body.data?.invite.status).toBe('declined');

    // The invite row is declined and no roster_entry / membership was created.
    const rows = db.select().from(rosterInvites).where(eq(rosterInvites.id, invite.id)).all();
    expect(rows[0]?.status).toBe('declined');
    expect(rows[0]?.declinedAt).toBeInstanceOf(Date);
    expect(db.select().from(rosterEntries).all()).toHaveLength(0);
    expect(db.select().from(athleteMemberships).all()).toHaveLength(0);
  });

  it('is one-shot: a second decline is refused with 409 INVITE_NOT_PENDING', async () => {
    const db = freshDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_decline_os');
    const coach = seedUser(db, ORG_A, 'u_coach_dos', 'coach-dos@test.invalid');
    const invite = seedInvite(db, ORG_A, team, coach, {
      id: 'rinv_decline_os',
      token: '4'.repeat(64),
    });

    const first = await buildApp(db).request(
      `/api/v1/public/roster-invites/${invite.plaintextToken}/decline`,
      { method: 'POST' },
    );
    expect(first.status).toBe(200);

    const second = await buildApp(db).request(
      `/api/v1/public/roster-invites/${invite.plaintextToken}/decline`,
      { method: 'POST' },
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as ResponseBody;
    expect(body.error?.code).toBe('INVITE_NOT_PENDING');
  });
});

// ── Token-at-rest invariant ────────────────────────────────────────────────

describe('plaintext token never persists', () => {
  it('only `token_hash` is stored — never the raw token', async () => {
    const db = freshDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_no_plain');
    const coach = seedUser(db, ORG_A, 'u_coach_np', 'coach-np@test.invalid');
    const plain = '5'.repeat(64);
    seedInvite(db, ORG_A, team, coach, { id: 'rinv_no_plain', token: plain });

    // Scan every column of every row in roster_invite for the plaintext.
    const rows = db.select().from(rosterInvites).all();
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(plain);
    // Hash IS present.
    expect(serialized).toContain(hashToken(plain));
  });
});
