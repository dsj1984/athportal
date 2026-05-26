// apps/web/src/middleware.production-lookup.test.ts
//
// Unit test pinning the `productionLookup` wiring landed in Task #889 of
// Story #878 (web runtime DB binding cutover). The lookup MUST call
// `getDb()` from `./lib/db` and pass the resulting handle to
// `getOnboardingStateBySubject()` from `@repo/shared/db/queries/users` with the
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

// `astro:middleware` is a virtual module resolved by the Astro runtime.
// The per-workspace `apps/web/vitest.config.ts` aliases it to a shim
// for `web-unit` runs, but the root workspace `unit` project (used by
// `npm run test:coverage`) does not — so stub the two functions the
// SUT actually imports.
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: unknown) => fn,
  sequence: (...fns: ReadonlyArray<unknown>) => fns,
}));

// Hoisted mock handles so the factory closures below can reach them
// without TDZ surprises. `vi.hoisted` is the Vitest-sanctioned escape
// hatch for sharing references between a factory and the test body.
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(() => ({ __tag: 'db-handle-stub' })),
  getOnboardingStateBySubject: vi.fn<(db: unknown, userId: string) => OnboardingState | null>(),
}));

vi.mock('./lib/db', () => ({
  getDb: mocks.getDb,
  __resetDbForTests: () => {
    /* not used in unit tier */
  },
}));

vi.mock('@repo/shared/db/queries/users', () => ({
  getOnboardingStateBySubject: mocks.getOnboardingStateBySubject,
}));

describe('productionLookup', () => {
  beforeEach(() => {
    mocks.getDb.mockClear();
    mocks.getOnboardingStateBySubject.mockReset();
  });

  it('passes the DB handle from getDb() and the subject id to getOnboardingStateBySubject, and returns its result', async () => {
    // Arrange
    const stamped: OnboardingState = {
      onboardedAt: new Date('2026-04-01T12:00:00.000Z'),
      ageAttestedAt: new Date('2026-04-01T12:00:05.000Z'),
    };
    mocks.getOnboardingStateBySubject.mockReturnValue(stamped);

    // Act
    const { productionLookup } = await import('./middleware');
    const result = productionLookup('clerk_sub_user_42');

    // Assert
    expect(mocks.getDb).toHaveBeenCalledTimes(1);
    expect(mocks.getOnboardingStateBySubject).toHaveBeenCalledTimes(1);
    expect(mocks.getOnboardingStateBySubject).toHaveBeenCalledWith(
      { __tag: 'db-handle-stub' },
      'clerk_sub_user_42',
    );
    expect(result).toBe(stamped);
  });

  it('forwards a null return from the accessor verbatim (no internal users row)', async () => {
    // Arrange
    mocks.getOnboardingStateBySubject.mockReturnValue(null);

    // Act
    const { productionLookup } = await import('./middleware');
    const result = productionLookup('clerk_sub_missing');

    // Assert
    expect(result).toBeNull();
    expect(mocks.getOnboardingStateBySubject).toHaveBeenCalledWith(
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
    mocks.getOnboardingStateBySubject.mockReturnValue(stamped);

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

  it('Story #903: returns null when getDb() throws (safe-default 302 instead of 500)', async () => {
    // Production deploy race / misconfigured TURSO_URL — getDb() throws
    // because resolveDatabasePath() refuses a libsql:// endpoint while
    // the web runtime is still wired to better-sqlite3. Before Story
    // #903 the throw propagated out of productionLookup → out of the
    // middleware → 500 for every signed-in request. After Story #903
    // the catch returns null and the gate 302s to /onboarding instead.
    mocks.getDb.mockImplementation(() => {
      throw new Error('TURSO_URL points to a libsql:// endpoint — fixture');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { productionLookup } = await import('./middleware');
    const result = productionLookup('clerk_sub_some_user');

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // The error message MUST name the gate so operators can grep logs;
    // it MUST NOT echo any secret-key material (the helper's own error
    // surface is responsible for redaction; the catch only forwards).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest's mock.calls type widens to any[][]; the runtime value here is a string from the catch's console.error template
    const logged: string = errorSpy.mock.calls[0]?.[0] ?? '';
    expect(logged).toMatch(/onboarding-gate/);
    expect(logged).toMatch(/productionLookup/);
    expect(logged).not.toMatch(/sk_test_/);
    expect(logged).not.toMatch(/sk_live_/);

    errorSpy.mockRestore();
  });

  it('Story #903: returns null when getOnboardingStateBySubject throws (DB query error)', async () => {
    // A second failure surface — the DB handle opens cleanly but the
    // query throws (e.g. schema mismatch, prepared-statement error from
    // a stale handle after a migration). Same safe-default: the catch
    // returns null and the gate 302s.
    //
    // Explicitly restore getDb to the happy-path stub so this test
    // exercises the query-time throw, not the prior test's getDb-throw.
    // `beforeEach` clears call counts but not implementations, so a
    // prior `mockImplementation` would otherwise leak in.
    mocks.getDb.mockImplementation(() => ({ __tag: 'db-handle-stub' }));
    mocks.getOnboardingStateBySubject.mockImplementation(() => {
      throw new Error('SQLITE_ERROR: no such column: clerk_subject_id — fixture');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { productionLookup } = await import('./middleware');
    const result = productionLookup('clerk_sub_query_failure');

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- vitest's mock.calls type widens to any[][]; the runtime value here is a string from the catch's console.error template
    const logged: string = errorSpy.mock.calls[0]?.[0] ?? '';
    expect(logged).toMatch(/SQLITE_ERROR/);

    errorSpy.mockRestore();
  });
});
