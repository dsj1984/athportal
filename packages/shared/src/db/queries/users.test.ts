/**
 * Unit tests for the sanctioned `getOnboardingState` accessor.
 *
 * The tests build an in-memory SQLite handle with the production
 * onboarding schema applied (via the bespoke `freshOnboardingDb` helper),
 * insert rows directly through the Drizzle table objects, and exercise
 * the accessor's two contractual behaviours: returns the stamped
 * timestamps verbatim, and returns `null` for a missing user.
 */

import { describe, expect, it } from 'vitest';
import { users } from '../schema/users';
import { freshOnboardingDb } from './__tests__/onboardingDb';
import { getOnboardingState } from './users';

describe('getOnboardingState', () => {
  it('returns the onboardedAt and ageAttestedAt for an existing user', () => {
    const db = freshOnboardingDb();
    const onboardedAt = new Date('2026-04-01T12:00:00.000Z');
    const ageAttestedAt = new Date('2026-04-01T12:00:05.000Z');
    db.insert(users)
      .values({
        id: 'u_1',
        clerkSubjectId: 'clerk_sub_1',
        email: 'athlete@example.invalid',
        role: 'member',
        onboardedAt,
        ageAttestedAt,
      })
      .run();

    const state = getOnboardingState(db, 'u_1');

    expect(state).not.toBeNull();
    expect(state?.onboardedAt?.getTime()).toBe(onboardedAt.getTime());
    expect(state?.ageAttestedAt?.getTime()).toBe(ageAttestedAt.getTime());
  });

  it('returns null timestamps for a present-but-not-onboarded user', () => {
    const db = freshOnboardingDb();
    db.insert(users)
      .values({
        id: 'u_2',
        clerkSubjectId: 'clerk_sub_2',
        email: 'pending@example.invalid',
        role: 'member',
      })
      .run();

    const state = getOnboardingState(db, 'u_2');

    expect(state).toEqual({ onboardedAt: null, ageAttestedAt: null });
  });

  it('returns null (not throws) when the user does not exist', () => {
    const db = freshOnboardingDb();

    const state = getOnboardingState(db, 'u_does_not_exist');

    expect(state).toBeNull();
  });
});
