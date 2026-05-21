/**
 * Unit tests for the parent-athlete link writer.
 *
 * Each test builds an in-memory SQLite handle via `freshOnboardingDb()`,
 * seeds the parent and athlete user rows, and exercises one contractual
 * branch of `establishLinkFromInvite`. The invite-token format under
 * test is `<base64url(targetAthleteEmail)>.<parentUserId>.<nonce>`.
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { parentAthleteLinks } from '../schema/parentAthleteLinks';
import { users } from '../schema/users';
import { freshOnboardingDb } from './__tests__/onboardingDb';
import { establishLinkFromInvite } from './parentAthleteLinks';

function seedUser(
  db: ReturnType<typeof freshOnboardingDb>,
  id: string,
  email: string,
): void {
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email,
      role: 'member',
    })
    .run();
}

function buildToken(targetAthleteEmail: string, parentUserId: string, nonce: string): string {
  const head = Buffer.from(targetAthleteEmail, 'utf8').toString('base64url');
  return `${head}.${parentUserId}.${nonce}`;
}

describe('establishLinkFromInvite', () => {
  it('writes the link and returns ok when the target email matches the athlete', () => {
    const db = freshOnboardingDb();
    seedUser(db, 'u_parent', 'parent@example.invalid');
    seedUser(db, 'u_athlete', 'athlete@example.invalid');
    const token = buildToken('athlete@example.invalid', 'u_parent', 'nonce-abc-123');

    const result = db.transaction((tx) =>
      establishLinkFromInvite(tx, {
        inviteToken: token,
        athleteUserId: 'u_athlete',
        athleteEmail: 'athlete@example.invalid',
      }),
    );

    expect(result).toBe('ok');
    const rows = db
      .select()
      .from(parentAthleteLinks)
      .where(eq(parentAthleteLinks.athleteUserId, 'u_athlete'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.parentUserId).toBe('u_parent');
    expect(rows[0]?.establishedVia).toBe('invite_acceptance');
  });

  it('stores invite_token_hash as the SHA-256 hex of the raw token', () => {
    const db = freshOnboardingDb();
    seedUser(db, 'u_parent', 'parent@example.invalid');
    seedUser(db, 'u_athlete', 'athlete@example.invalid');
    const token = buildToken('athlete@example.invalid', 'u_parent', 'nonce-secret');
    const expectedHash = createHash('sha256').update(token, 'utf8').digest('hex');

    db.transaction((tx) =>
      establishLinkFromInvite(tx, {
        inviteToken: token,
        athleteUserId: 'u_athlete',
        athleteEmail: 'athlete@example.invalid',
      }),
    );

    const rows = db
      .select()
      .from(parentAthleteLinks)
      .where(eq(parentAthleteLinks.athleteUserId, 'u_athlete'))
      .all();
    expect(rows[0]?.inviteTokenHash).toBe(expectedHash);
    // The raw token MUST NOT appear in any persisted column.
    expect(rows[0]?.inviteTokenHash).not.toBe(token);
    expect(rows[0]?.inviteTokenHash.includes('nonce-secret')).toBe(false);
  });

  it('returns mismatch and writes no row when the actor email differs from the invite target', () => {
    const db = freshOnboardingDb();
    seedUser(db, 'u_parent', 'parent@example.invalid');
    seedUser(db, 'u_athlete', 'athlete@example.invalid');
    const token = buildToken('someone-else@example.invalid', 'u_parent', 'nonce-abc-123');

    const result = db.transaction((tx) =>
      establishLinkFromInvite(tx, {
        inviteToken: token,
        athleteUserId: 'u_athlete',
        athleteEmail: 'athlete@example.invalid',
      }),
    );

    expect(result).toBe('mismatch');
    const rows = db.select().from(parentAthleteLinks).all();
    expect(rows).toHaveLength(0);
  });

  it('returns mismatch for a malformed token (wrong segment count)', () => {
    const db = freshOnboardingDb();
    seedUser(db, 'u_athlete', 'athlete@example.invalid');

    const result = db.transaction((tx) =>
      establishLinkFromInvite(tx, {
        inviteToken: 'only-one-segment',
        athleteUserId: 'u_athlete',
        athleteEmail: 'athlete@example.invalid',
      }),
    );

    expect(result).toBe('mismatch');
  });

  it('returns mismatch when the encoded parent user does not exist', () => {
    const db = freshOnboardingDb();
    // No parent row seeded.
    seedUser(db, 'u_athlete', 'athlete@example.invalid');
    const token = buildToken('athlete@example.invalid', 'u_does_not_exist', 'nonce-abc');

    const result = db.transaction((tx) =>
      establishLinkFromInvite(tx, {
        inviteToken: token,
        athleteUserId: 'u_athlete',
        athleteEmail: 'athlete@example.invalid',
      }),
    );

    expect(result).toBe('mismatch');
    expect(db.select().from(parentAthleteLinks).all()).toHaveLength(0);
  });

  it('throws on the second insert when the unique (parent, athlete) constraint is violated', () => {
    const db = freshOnboardingDb();
    seedUser(db, 'u_parent', 'parent@example.invalid');
    seedUser(db, 'u_athlete', 'athlete@example.invalid');
    db.transaction((tx) =>
      establishLinkFromInvite(tx, {
        inviteToken: buildToken('athlete@example.invalid', 'u_parent', 'nonce-first'),
        athleteUserId: 'u_athlete',
        athleteEmail: 'athlete@example.invalid',
      }),
    );

    expect(() =>
      db.transaction((tx) =>
        establishLinkFromInvite(tx, {
          inviteToken: buildToken('athlete@example.invalid', 'u_parent', 'nonce-second'),
          athleteUserId: 'u_athlete',
          athleteEmail: 'athlete@example.invalid',
        }),
      ),
    ).toThrow(/UNIQUE/i);
  });

  it('matches emails case-insensitively', () => {
    const db = freshOnboardingDb();
    seedUser(db, 'u_parent', 'parent@example.invalid');
    seedUser(db, 'u_athlete', 'athlete@example.invalid');
    // Token carries mixed-case target; athleteEmail is lower-case.
    const token = buildToken('Athlete@Example.Invalid', 'u_parent', 'nonce-mixed');

    const result = db.transaction((tx) =>
      establishLinkFromInvite(tx, {
        inviteToken: token,
        athleteUserId: 'u_athlete',
        athleteEmail: 'athlete@example.invalid',
      }),
    );

    expect(result).toBe('ok');
  });
});
