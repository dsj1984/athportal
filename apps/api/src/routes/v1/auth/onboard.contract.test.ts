// apps/api/src/routes/v1/auth/onboard.contract.test.ts
//
// Contract test for POST /api/v1/auth/onboard (Story #564, Task #575).
//
// Asserts the wire shape and DB side-effects of the single-transaction
// onboarding handler (Tech Spec #490):
//
//   - happy path: 200 + canonical success envelope, two
//     `userLegalAgreements` rows, `users.onboarded_at` + `age_attested_at`
//     stamped with the transaction clock, `users.email` updated to the
//     verified primary.
//   - idempotency: a second submission from an already-onboarded actor
//     returns 200 with the existing timestamp and writes nothing new.
//   - INVALID_BODY: Zod boundary rejects bad payloads (missing keys,
//     wrong `isAtLeast13` literal, unknown extra keys).
//   - EMAIL_UNVERIFIED: Clerk reports the primary email as unverified.
//   - INACTIVE_LEGAL_VERSION: submitted version does not match the
//     currently-active document and no rows are written.
//   - INVITE_EMAIL_MISMATCH: invite token target email ≠ actor — the
//     transaction rolls back; no acceptances and no link survive.
//   - invite-success: a well-formed invite token writes the
//     `parent_athlete_links` row alongside the acceptances.
//
// Composition: real production middleware chain (`requireInternalUser`)
// + the test-auth seam (`createTestApp(db, { actor })`). `@clerk/backend`
// is mocked because the JWT validator path is skipped by the test-auth
// adapter and the email-verification re-query call is what the test
// drives.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  legalDocuments,
  parentAthleteLinks,
  userLegalAgreements,
  users,
} from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn(),
}));

import { createClerkClient } from '@clerk/backend';
import { type RequireInternalUserEnv, requireInternalUser } from '../../../middleware/auth';
import { authRoute } from './index';

const mockedCreateClerkClient = vi.mocked(createClerkClient);

const MIGRATION_0000 = join(
  __dirname,
  '../../../../../../packages/shared/src/db/migrations/0000_auth_and_rbac.sql',
);
const MIGRATION_0001 = join(
  __dirname,
  '../../../../../../packages/shared/src/db/migrations/0001_onboarding_schema.sql',
);
// Story #1054 / F33 — adds the nullable first_name/last_name columns the
// onboarding handler now promotes from Clerk.
const MIGRATION_0010 = join(
  __dirname,
  '../../../../../../packages/shared/src/db/migrations/0010_users_name.sql',
);

const fullSchema = {
  users,
  legalDocuments,
  userLegalAgreements,
  parentAthleteLinks,
};

function applyMigration(client: Database.Database, path: string): void {
  const sql = readFileSync(path, 'utf8');
  for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
    if (stmt.length > 0) client.exec(stmt);
  }
}

function freshOnboardingProductionDb() {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  applyMigration(client, MIGRATION_0000);
  applyMigration(client, MIGRATION_0001);
  applyMigration(client, MIGRATION_0010);
  return drizzle(client, { schema: fullSchema });
}

type ProductionDb = ReturnType<typeof freshOnboardingProductionDb>;

const ACTOR: AuthContext = {
  userId: 'u_actor_athlete',
  clerkSubjectId: 'user_test_athlete_onboard',
  email: 'athlete@test.invalid',
  role: 'member',
  orgId: null,
  teamId: null,
};

const ACTIVE_TOS_VERSION = '2026-04-15';
const ACTIVE_PRIVACY_VERSION = '2026-04-15';

function seedActor(db: ProductionDb, overrides: Partial<typeof users.$inferInsert> = {}): void {
  db.insert(users)
    .values({
      id: ACTOR.userId,
      clerkSubjectId: ACTOR.clerkSubjectId,
      email: 'jit-placeholder@clerk-jit.invalid',
      role: ACTOR.role,
      orgId: ACTOR.orgId,
      teamId: ACTOR.teamId,
      ...overrides,
    })
    .run();
}

function seedActiveLegalDocs(db: ProductionDb): void {
  db.insert(legalDocuments)
    .values([
      {
        id: 'tos_active',
        kind: 'terms_of_service',
        version: ACTIVE_TOS_VERSION,
        effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
        bodyUrl: 'https://example.invalid/tos',
      },
      {
        id: 'pp_active',
        kind: 'privacy_policy',
        version: ACTIVE_PRIVACY_VERSION,
        effectiveAt: new Date('2026-04-15T00:00:00.000Z'),
        bodyUrl: 'https://example.invalid/pp',
      },
    ])
    .run();
}

function buildApp(db: ProductionDb, actor: AuthContext = ACTOR) {
  const app = createTestApp(db, {
    actor,
  }) as unknown as Hono<RequireInternalUserEnv>;
  app.use('/api/v1/*', requireInternalUser());
  app.route('/api/v1/auth', authRoute);
  return app;
}

function stubClerkUser(
  options: {
    verified?: boolean;
    email?: string;
    throws?: boolean;
    firstName?: string | null;
    lastName?: string | null;
  } = {},
): void {
  const {
    verified = true,
    email = 'athlete@test.invalid',
    throws = false,
    firstName = 'Ada',
    lastName = 'Lovelace',
  } = options;
  const getUser = throws
    ? vi.fn().mockRejectedValue(new Error('clerk_unavailable'))
    : vi.fn().mockResolvedValue({
        id: ACTOR.clerkSubjectId,
        firstName,
        lastName,
        primaryEmailAddressId: 'idn_primary',
        emailAddresses: [
          {
            id: 'idn_primary',
            emailAddress: email,
            verification: { status: verified ? 'verified' : 'unverified' },
          },
        ],
      });
  mockedCreateClerkClient.mockReturnValue({
    users: { getUser },
  } as unknown as ReturnType<typeof createClerkClient>);
}

const ENV = {
  CLERK_SECRET_KEY: 'sk_test_unit',
  CLERK_PUBLISHABLE_KEY: 'pk_test_unit',
  ANALYTICS: { writeDataPoint: () => {} },
};

const VALID_BODY = {
  profile: {
    displayName: 'Ada L.',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
  ageAttestation: { isAtLeast13: true },
  legalAcceptances: {
    termsOfServiceVersion: ACTIVE_TOS_VERSION,
    privacyPolicyVersion: ACTIVE_PRIVACY_VERSION,
  },
} as const;

beforeEach(() => {
  mockedCreateClerkClient.mockReset();
});

describe('POST /api/v1/auth/onboard — happy path', () => {
  it('stamps onboarded_at, writes two acceptances, and updates the email', async () => {
    // Arrange
    const db = freshOnboardingProductionDb();
    seedActor(db);
    seedActiveLegalDocs(db);
    stubClerkUser({ verified: true, email: 'athlete@test.invalid' });
    const app = buildApp(db);

    // Act
    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      },
      ENV,
    );

    // Assert — wire shape
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        user: {
          userId: string;
          email: string;
          role: string;
          orgId: string | null;
          teamId: string | null;
          onboardedAt: string;
        };
        onboardedAt: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.user.userId).toBe(ACTOR.userId);
    expect(body.data.user.email).toBe('athlete@test.invalid');
    expect(body.data.user.role).toBe('member');
    expect(typeof body.data.onboardedAt).toBe('string');
    expect(body.data.user.onboardedAt).toBe(body.data.onboardedAt);

    // Assert — DB side-effects (sanctioned reads via direct schema
    // queries; the lint sentinel rule allows direct column access in
    // test files).
    const reloaded = await db.query.users.findFirst({
      where: eq(users.id, ACTOR.userId),
    });
    expect(reloaded?.email).toBe('athlete@test.invalid');
    expect(reloaded?.onboardedAt).toBeInstanceOf(Date);
    expect(reloaded?.ageAttestedAt).toBeInstanceOf(Date);
    expect(reloaded?.onboardedAt?.getTime()).toBe(reloaded?.ageAttestedAt?.getTime());
    // Story #1054 / F33: the Clerk display name is promoted into `users`
    // inside the same transaction that promotes the email.
    expect(reloaded?.firstName).toBe('Ada');
    expect(reloaded?.lastName).toBe('Lovelace');

    const agreements = await db.query.userLegalAgreements.findMany({
      where: eq(userLegalAgreements.userId, ACTOR.userId),
    });
    expect(agreements).toHaveLength(2);
    const docIds = agreements.map((r) => r.legalDocumentId).sort();
    expect(docIds).toEqual(['pp_active', 'tos_active']);
  });
});

describe('POST /api/v1/auth/onboard — users.email side-effect', () => {
  // Pins the JIT-placeholder → Clerk-verified-email side-effect described
  // in `onboard.ts` (the row carries `<sub>@clerk-jit.invalid` after JIT;
  // onboarding overwrites it with the server-verified primary email).
  // Tech Spec #490 §Architecture mentions stamping `onboarded_at` and
  // `age_attested_at`; the `users.email` write is the implementation
  // consequence of the JIT-placeholder design and MUST be auditable
  // independent of the happy-path body assertions. Epic #8 code-review
  // HR-4.
  it('overwrites the JIT-placeholder users.email with the Clerk-verified primary email', async () => {
    // Arrange — seed the actor with the synthetic placeholder so the
    // assertion proves an overwrite rather than a no-op equality.
    const db = freshOnboardingProductionDb();
    seedActor(db, { email: `${ACTOR.clerkSubjectId}@clerk-jit.invalid` });
    seedActiveLegalDocs(db);
    const verifiedEmail = 'ada.lovelace@verified.example.invalid';
    stubClerkUser({ verified: true, email: verifiedEmail });
    const app = buildApp(db);

    // Act
    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      },
      ENV,
    );

    // Assert — wire shape
    expect(res.status).toBe(200);

    // Assert — DB side-effect: email is overwritten with the verified
    // primary, the JIT placeholder no longer appears in the row.
    const reloaded = await db.query.users.findFirst({
      where: eq(users.id, ACTOR.userId),
    });
    expect(reloaded?.email).toBe(verifiedEmail);
    expect(reloaded?.email).not.toContain('@clerk-jit.invalid');
  });
});

describe('POST /api/v1/auth/onboard — Clerk name promotion (Story #1054)', () => {
  it('promotes the Clerk firstName/lastName into users alongside the email', async () => {
    // Arrange — Clerk reports a profile name distinct from the local row.
    const db = freshOnboardingProductionDb();
    seedActor(db);
    seedActiveLegalDocs(db);
    stubClerkUser({ verified: true, firstName: 'Grace', lastName: 'Hopper' });
    const app = buildApp(db);

    // Act
    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      },
      ENV,
    );

    // Assert — wire shape
    expect(res.status).toBe(200);

    // Assert — DB side-effect: the name columns carry the Clerk values.
    const reloaded = await db.query.users.findFirst({
      where: eq(users.id, ACTOR.userId),
    });
    expect(reloaded?.firstName).toBe('Grace');
    expect(reloaded?.lastName).toBe('Hopper');
  });

  it('stores null name columns when Clerk omits firstName/lastName', async () => {
    // Arrange — a Clerk profile with no name (e.g. email-only sign-up).
    const db = freshOnboardingProductionDb();
    seedActor(db);
    seedActiveLegalDocs(db);
    stubClerkUser({ verified: true, firstName: null, lastName: null });
    const app = buildApp(db);

    // Act
    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      },
      ENV,
    );

    // Assert — wire shape
    expect(res.status).toBe(200);

    // Assert — DB side-effect: name columns are null, not the email or a
    // sentinel; the roster projection falls back to the email-derived
    // name when both are null.
    const reloaded = await db.query.users.findFirst({
      where: eq(users.id, ACTOR.userId),
    });
    expect(reloaded?.firstName).toBeNull();
    expect(reloaded?.lastName).toBeNull();
  });
});

describe('POST /api/v1/auth/onboard — idempotency', () => {
  it('returns 200 with the existing onboardedAt and writes nothing on replay', async () => {
    // Arrange — actor already onboarded.
    const db = freshOnboardingProductionDb();
    const priorStamp = new Date('2026-04-20T12:00:00.000Z');
    seedActor(db, {
      email: 'athlete@test.invalid',
      onboardedAt: priorStamp,
      ageAttestedAt: priorStamp,
    });
    seedActiveLegalDocs(db);
    stubClerkUser({ verified: true });
    const app = buildApp(db);

    // Act
    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      },
      ENV,
    );

    // Assert — wire shape mirrors the existing state
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { onboardedAt: string };
    };
    expect(body.success).toBe(true);
    expect(new Date(body.data.onboardedAt).getTime()).toBe(priorStamp.getTime());

    // Assert — no acceptance rows written
    const agreements = await db.query.userLegalAgreements.findMany({
      where: eq(userLegalAgreements.userId, ACTOR.userId),
    });
    expect(agreements).toHaveLength(0);

    // The replay short-circuits BEFORE the Clerk call, so the stub
    // should never have been consulted for `getUser`.
    expect(mockedCreateClerkClient).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/auth/onboard — INVALID_BODY', () => {
  it('returns 400 INVALID_BODY when the JSON is malformed', async () => {
    const db = freshOnboardingProductionDb();
    seedActor(db);
    seedActiveLegalDocs(db);
    const app = buildApp(db);

    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      },
      ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_BODY' },
    });
  });

  it('returns 400 INVALID_BODY when isAtLeast13 is not the literal true', async () => {
    const db = freshOnboardingProductionDb();
    seedActor(db);
    seedActiveLegalDocs(db);
    const app = buildApp(db);

    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...VALID_BODY,
          ageAttestation: { isAtLeast13: false },
        }),
      },
      ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_BODY' },
    });
  });

  it('returns 400 INVALID_BODY when an unknown extra key is present (strict schema)', async () => {
    const db = freshOnboardingProductionDb();
    seedActor(db);
    seedActiveLegalDocs(db);
    const app = buildApp(db);

    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...VALID_BODY, acceptedTerms: true }),
      },
      ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_BODY' },
    });
  });
});

describe('POST /api/v1/auth/onboard — EMAIL_UNVERIFIED', () => {
  it('returns 400 EMAIL_UNVERIFIED and writes nothing when Clerk reports unverified', async () => {
    const db = freshOnboardingProductionDb();
    seedActor(db);
    seedActiveLegalDocs(db);
    stubClerkUser({ verified: false });
    const app = buildApp(db);

    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      },
      ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'EMAIL_UNVERIFIED' },
    });

    const agreements = await db.query.userLegalAgreements.findMany({
      where: eq(userLegalAgreements.userId, ACTOR.userId),
    });
    expect(agreements).toHaveLength(0);
  });

  it('returns 400 EMAIL_UNVERIFIED when the Clerk call throws', async () => {
    const db = freshOnboardingProductionDb();
    seedActor(db);
    seedActiveLegalDocs(db);
    stubClerkUser({ throws: true });
    const app = buildApp(db);

    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(VALID_BODY),
      },
      ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'EMAIL_UNVERIFIED' },
    });
  });
});

describe('POST /api/v1/auth/onboard — INACTIVE_LEGAL_VERSION', () => {
  it('returns 400 INACTIVE_LEGAL_VERSION and rolls back the transaction', async () => {
    const db = freshOnboardingProductionDb();
    seedActor(db);
    seedActiveLegalDocs(db);
    stubClerkUser({ verified: true });
    const app = buildApp(db);

    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...VALID_BODY,
          legalAcceptances: {
            termsOfServiceVersion: '2025-stale',
            privacyPolicyVersion: ACTIVE_PRIVACY_VERSION,
          },
        }),
      },
      ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INACTIVE_LEGAL_VERSION' },
    });

    // Rolled back: no acceptance rows.
    const agreements = await db.query.userLegalAgreements.findMany({
      where: eq(userLegalAgreements.userId, ACTOR.userId),
    });
    expect(agreements).toHaveLength(0);

    // Rolled back: users.onboarded_at is still null (the actor was
    // seeded without a stamp).
    const reloaded = await db.query.users.findFirst({
      where: eq(users.id, ACTOR.userId),
    });
    expect(reloaded?.onboardedAt).toBeNull();
  });
});

describe('POST /api/v1/auth/onboard — invite token paths', () => {
  it('returns 400 INVITE_EMAIL_MISMATCH and rolls back everything when target email differs', async () => {
    const db = freshOnboardingProductionDb();
    // Seed a parent user the invite token references.
    db.insert(users)
      .values({
        id: 'u_parent_1',
        clerkSubjectId: 'user_parent_1',
        email: 'parent@test.invalid',
        role: 'member',
      })
      .run();
    seedActor(db);
    seedActiveLegalDocs(db);
    stubClerkUser({ verified: true, email: 'athlete@test.invalid' });
    const app = buildApp(db);

    // Token target email != actor email.
    const tokenTargetEmail = Buffer.from('someone-else@test.invalid', 'utf8').toString('base64url');
    const inviteToken = `${tokenTargetEmail}.u_parent_1.nonce123`;

    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...VALID_BODY, inviteToken }),
      },
      ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVITE_EMAIL_MISMATCH' },
    });

    // Whole transaction rolled back: no acceptances, no link, no stamp.
    const agreements = await db.query.userLegalAgreements.findMany({
      where: eq(userLegalAgreements.userId, ACTOR.userId),
    });
    expect(agreements).toHaveLength(0);

    const link = await db.query.parentAthleteLinks.findFirst({
      where: and(
        eq(parentAthleteLinks.parentUserId, 'u_parent_1'),
        eq(parentAthleteLinks.athleteUserId, ACTOR.userId),
      ),
    });
    expect(link).toBeUndefined();

    const reloaded = await db.query.users.findFirst({
      where: eq(users.id, ACTOR.userId),
    });
    expect(reloaded?.onboardedAt).toBeNull();
  });

  it('writes the parent-athlete link alongside the acceptances when the invite matches', async () => {
    const db = freshOnboardingProductionDb();
    db.insert(users)
      .values({
        id: 'u_parent_2',
        clerkSubjectId: 'user_parent_2',
        email: 'parent2@test.invalid',
        role: 'member',
      })
      .run();
    seedActor(db);
    seedActiveLegalDocs(db);
    stubClerkUser({ verified: true, email: 'athlete@test.invalid' });
    const app = buildApp(db);

    const tokenTargetEmail = Buffer.from('athlete@test.invalid', 'utf8').toString('base64url');
    const inviteToken = `${tokenTargetEmail}.u_parent_2.nonceabc`;

    const res = await app.request(
      '/api/v1/auth/onboard',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...VALID_BODY, inviteToken }),
      },
      ENV,
    );

    expect(res.status).toBe(200);

    const link = await db.query.parentAthleteLinks.findFirst({
      where: and(
        eq(parentAthleteLinks.parentUserId, 'u_parent_2'),
        eq(parentAthleteLinks.athleteUserId, ACTOR.userId),
      ),
    });
    expect(link).toBeDefined();
    expect(link?.establishedVia).toBe('invite_acceptance');
    // SHA-256 of the raw token is a 64-char hex digest; the raw token
    // itself MUST NOT appear in the column.
    expect(link?.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(link?.inviteTokenHash).not.toContain(inviteToken);

    const agreements = await db.query.userLegalAgreements.findMany({
      where: eq(userLegalAgreements.userId, ACTOR.userId),
    });
    expect(agreements).toHaveLength(2);
  });
});
