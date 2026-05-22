// apps/api/src/routes/webhooks/clerk-invitation-accepted.contract.test.ts
//
// Contract test for POST /webhooks/clerk/invitation-accepted (Epic #10
// / Story #655 / Task #666).
//
// Pins four wire-shape invariants:
//
//   1. A missing / wrong signature returns 401 UNAUTHENTICATED with the
//      canonical error envelope. The verifier seam throws and the
//      handler MUST NOT echo the verifier's error detail.
//   2. A verified `invitation.accepted` event for an existing local
//      row:
//        - flips the row's `status` to `'accepted'`
//        - inserts coach_assignments rows for each team_id when
//          `role === 'coach'`
//        - inserts athlete_memberships rows for each team_id when
//          `role === 'athlete'`
//   3. A duplicate delivery for the same `clerk_invitation_id` is
//      idempotent — no second set of membership rows is inserted.
//   4. A verified event of a different type (e.g. `user.created`) is
//      200-acked and ignored.
//
// Per `docs/testing-strategy.md` § Contract: uses a real
// better-sqlite3 handle backed by the production migrations, mounts
// the real handler, and only mocks the third-party signature verifier
// (the test-auth seam pattern, applied to webhooks).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  athleteMemberships,
  coachAssignments,
  invitations,
  organizations,
  teams,
  users,
} from '@repo/shared/db/schema';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../env';
import {
  type ClerkInvitationWebhookEnv,
  clerkInvitationAcceptedRoute,
} from './clerk-invitation-accepted';
import type { VerifyWebhook } from './clerk-invitation-shared';

const MIGRATIONS_DIR = join(__dirname, '../../../../../packages/shared/src/db/migrations');
const MIGRATION_FILES = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_invitations.sql',
  '0004_team_metadata.sql',
];

function freshProductionDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, {
    schema: { users, organizations, teams, invitations, coachAssignments, athleteMemberships },
  });
}

interface SeedResult {
  readonly orgId: string;
  readonly teamIdA: string;
  readonly teamIdB: string;
  readonly adminUserId: string;
  readonly invitedUserId: string;
}

function seedGraph(db: ReturnType<typeof freshProductionDb>): SeedResult {
  const orgId = 'org_seed_1';
  const teamIdA = 'team_a';
  const teamIdB = 'team_b';
  const adminUserId = 'u_admin_1';
  const invitedUserId = 'u_invitee_1';

  db.insert(organizations)
    .values({
      id: orgId,
      name: 'Seed Org',
      organizationType: 'CLUB',
    })
    .run();
  db.insert(teams)
    .values([
      { id: teamIdA, orgId, name: 'Team A' },
      { id: teamIdB, orgId, name: 'Team B' },
    ])
    .run();
  db.insert(users)
    .values({
      id: adminUserId,
      clerkSubjectId: 'user_admin_subject',
      email: 'admin@test.invalid',
      role: 'org_admin',
      orgId,
    })
    .run();
  db.insert(users)
    .values({
      id: invitedUserId,
      clerkSubjectId: 'user_invitee_subject',
      email: 'invitee@test.invalid',
      role: 'member',
      orgId,
    })
    .run();

  return { orgId, teamIdA, teamIdB, adminUserId, invitedUserId };
}

function buildApp(
  db: ReturnType<typeof freshProductionDb>,
  verifier: VerifyWebhook,
): Hono<ClerkInvitationWebhookEnv> {
  const app = new Hono<ClerkInvitationWebhookEnv>();
  app.use('*', async (c, next) => {
    // Bind the test DB and the fake verifier into request context. The
    // production app would set the DB in a dedicated middleware; the
    // verifier is unset in production so the handler falls back to
    // `@clerk/backend/webhooks#verifyWebhook`.
    c.set('db', db as unknown);
    c.set('verifyWebhook', verifier);
    await next();
  });
  app.route('/webhooks/clerk/invitation-accepted', clerkInvitationAcceptedRoute);
  return app;
}

const ENV: Pick<Env, 'CLERK_WEBHOOK_SIGNING_SECRET'> = {
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_test',
};

describe('POST /webhooks/clerk/invitation-accepted — contract', () => {
  it('returns 401 UNAUTHENTICATED when the signature verifier throws', async () => {
    const db = freshProductionDb();
    seedGraph(db);
    const verifier: VerifyWebhook = () => Promise.reject(new Error('signature mismatch'));
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/invitation-accepted',
      { method: 'POST', body: JSON.stringify({ type: 'invitation.accepted' }) },
      ENV,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('flips the local invitation to accepted and inserts coach_assignments for role=coach', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const clerkInvitationId = 'inv_clerk_coach_1';

    db.insert(invitations)
      .values({
        id: 'inv_local_1',
        orgId: seed.orgId,
        email: 'invitee@test.invalid',
        role: 'coach',
        teamIds: [seed.teamIdA, seed.teamIdB],
        clerkInvitationId,
        status: 'pending',
        invitedByUserId: seed.adminUserId,
      })
      .run();

    const verifier: VerifyWebhook = () =>
      Promise.resolve({
        type: 'invitation.accepted',
        data: { id: clerkInvitationId, user_id: seed.invitedUserId },
      });
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/invitation-accepted',
      { method: 'POST', body: '{}' },
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });

    const localRows = db
      .select()
      .from(invitations)
      .where(eq(invitations.clerkInvitationId, clerkInvitationId))
      .all();
    expect(localRows).toHaveLength(1);
    expect(localRows[0]?.status).toBe('accepted');

    const assignmentRows = db
      .select()
      .from(coachAssignments)
      .where(eq(coachAssignments.coachUserId, seed.invitedUserId))
      .all();
    expect(assignmentRows).toHaveLength(2);
    const teamIds = assignmentRows.map((r) => r.teamId).sort();
    expect(teamIds).toEqual([seed.teamIdA, seed.teamIdB].sort());
    for (const row of assignmentRows) {
      expect(row.orgId).toBe(seed.orgId);
    }
  });

  it('flips the local invitation to accepted and inserts an athlete_memberships row for role=athlete', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const clerkInvitationId = 'inv_clerk_athlete_1';

    db.insert(invitations)
      .values({
        id: 'inv_local_2',
        orgId: seed.orgId,
        email: 'athlete@test.invalid',
        role: 'athlete',
        teamIds: [seed.teamIdA],
        clerkInvitationId,
        status: 'pending',
        invitedByUserId: seed.adminUserId,
      })
      .run();

    const verifier: VerifyWebhook = () =>
      Promise.resolve({
        type: 'invitation.accepted',
        data: { id: clerkInvitationId, user_id: seed.invitedUserId },
      });
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/invitation-accepted',
      { method: 'POST', body: '{}' },
      ENV,
    );

    expect(res.status).toBe(200);

    const membershipRows = db
      .select()
      .from(athleteMemberships)
      .where(eq(athleteMemberships.athleteUserId, seed.invitedUserId))
      .all();
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0]?.teamId).toBe(seed.teamIdA);
    expect(membershipRows[0]?.orgId).toBe(seed.orgId);
  });

  it('is idempotent — a duplicate delivery does not create a second set of membership rows', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const clerkInvitationId = 'inv_clerk_dup_1';

    db.insert(invitations)
      .values({
        id: 'inv_local_3',
        orgId: seed.orgId,
        email: 'invitee@test.invalid',
        role: 'coach',
        teamIds: [seed.teamIdA],
        clerkInvitationId,
        status: 'pending',
        invitedByUserId: seed.adminUserId,
      })
      .run();

    const verifier: VerifyWebhook = () =>
      Promise.resolve({
        type: 'invitation.accepted',
        data: { id: clerkInvitationId, user_id: seed.invitedUserId },
      });
    const app = buildApp(db, verifier);

    // First delivery
    const firstRes = await app.request(
      '/webhooks/clerk/invitation-accepted',
      { method: 'POST', body: '{}' },
      ENV,
    );
    expect(firstRes.status).toBe(200);

    // Second delivery — must be idempotent.
    const secondRes = await app.request(
      '/webhooks/clerk/invitation-accepted',
      { method: 'POST', body: '{}' },
      ENV,
    );
    expect(secondRes.status).toBe(200);
    expect(await secondRes.json()).toMatchObject({ success: true, idempotent: true });

    const assignmentRows = db
      .select()
      .from(coachAssignments)
      .where(eq(coachAssignments.coachUserId, seed.invitedUserId))
      .all();
    expect(assignmentRows).toHaveLength(1);
  });

  it('200-acks and ignores a verified event of a different type', async () => {
    const db = freshProductionDb();
    seedGraph(db);
    const verifier: VerifyWebhook = () =>
      Promise.resolve({
        type: 'user.created',
        data: { id: 'user_unrelated' },
      });
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/invitation-accepted',
      { method: 'POST', body: '{}' },
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, ignored: true });
  });

  it('200-ignores a verified accept whose Clerk id has no matching local row', async () => {
    const db = freshProductionDb();
    seedGraph(db);
    const verifier: VerifyWebhook = () =>
      Promise.resolve({
        type: 'invitation.accepted',
        data: { id: 'inv_clerk_unknown', user_id: 'u_stranger' },
      });
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/invitation-accepted',
      { method: 'POST', body: '{}' },
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, ignored: true });
  });
});
