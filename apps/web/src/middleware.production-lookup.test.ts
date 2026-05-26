// apps/web/src/middleware.production-lookup.test.ts
//
// Unit test pinning the `productionLookup` wiring landed in Task #889 of
// Story #878 (web runtime DB binding cutover). The lookup MUST call
// `getDb()` from `./lib/db` and pass the resulting handle to
// `getOnboardingState()` from `@repo/shared/db/queries/users` with the
// Clerk subject id verbatim, then return whatever the accessor returns.
//
// This is the load-bearing test for the cutover: a future regression
// that silently restores `productionLookup` to a `() => null` stub (or
// any other constant) MUST flip this test red. The regression-guard
// case at the bottom of the file pins exactly that property.
//
// Unit tier per `.agents/rules/testing-standards.md § Unit` — both
// the DB handle factory and the accessor are mocked so the test never
// touches the filesystem or schema.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingState } from './middleware';

// Hoisted mock handles so the factory closures below can reach them
// without TDZ surprises. `vi.hoisted` is the Vitest-sanctioned escape
// hatch for sharing references between a factory and the test body.
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(() => ({ __tag: 'db-handle-stub' })),
  getOnboardingState: vi.fn<(db: unknown, userId: string) => OnboardingState | null>(),
}));

vi.mock('./lib/db', () => ({
  getDb: mocks.getDb,
  __resetDbForTests: () => {
    /* not used in unit tier */
  },
}));

vi.mock('@repo/shared/db/queries/users', () => ({
  getOnboardingState: mocks.getOnboardingState,
}));

describe('productionLookup', () => {
  beforeEach(() => {
    mocks.getDb.mockClear();
    mocks.getOnboardingState.mockReset();
  });

  it('passes the DB handle from getDb() and the subject id to getOnboardingState, and returns its result', async () => {
    // Arrange
    const stamped: OnboardingState = {
      onboardedAt: new Date('2026-04-01T12:00:00.000Z'),
      ageAttestedAt: new Date('2026-04-01T12:00:05.000Z'),
    };
    mocks.getOnboardingState.mockReturnValue(stamped);

    // Act
    const { productionLookup } = await import('./middleware');
    const result = productionLookup('clerk_sub_user_42');

    // Assert
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.getOnboardingState).toHaveBeenCalledTimes(1);
    expect(mocks.getOnboardingState).toHaveBeenCalledWith(
      { __tag: 'db-handle-stub' },
      'clerk_sub_user_42',
    );
    expect(result).toBe(stamped);
  });

  it('forwards a null return from the accessor verbatim (no internal users row)', async () => {
    // Arrange
    mocks.getOnboardingState.mockReturnValue(null);

    // Act
    const { productionLookup } = await import('./middleware');
    const result = productionLookup('clerk_sub_missing');

    // Assert
    expect(result).toBeNull();
    expect(mocks.getOnboardingState).toHaveBeenCalledWith(
      { __tag: 'db-handle-stub' },
      'clerk_sub_missing',
    );
  });

  it('regression guard: productionLookup is NOT the legacy `() => null` stub', async () => {
    // PRD G1 / AC-15: a signed-in user with a stamped `onboarded_at`
    // MUST pass through the gate. The legacy placeholder (`() => null`)
    // would have returned null for every subject and trapped every user
    // on `/onboarding`. This assertion proves that the production
    // implementation actually consults the DB and surfaces stamped
    // state, so a future refactor that re-stubs the lookup cannot land
    // without breaking this test.
    const stamped: OnboardingState = {
      onboardedAt: new Date('2026-05-01T00:00:00.000Z'),
      ageAttestedAt: null,
    };
    mocks.getOnboardingState.mockReturnValue(stamped);

    const { productionLookup } = await import('./middleware');
    const result = productionLookup('clerk_sub_onboarded');

    // A stub `() => null` would have returned null here; the real
    // implementation routes through the mocked accessor and returns
    // the stamped state. The strict equality on `onboardedAt` is the
    // load-bearing assertion — if a future change re-stubs the lookup,
    // `result` becomes null and this test flips red.
    expect(result).not.toBeNull();
    expect(result?.onboardedAt?.getTime()).toBe(stamped.onboardedAt?.getTime());
  });
});
