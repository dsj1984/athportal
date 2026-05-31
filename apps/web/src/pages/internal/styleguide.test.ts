// apps/web/src/pages/internal/styleguide.test.ts
//
// Pure-function unit tests for the `/internal/styleguide` gate. The
// gate is the only piece of the page exercised under Vitest — the
// `.astro` template wires the gate into Astro's request lifecycle.
//
// Story #723 / Task #734 — gate decision tests.
// Story #749 / Task #752 — `productionRoleLookup` real-DB read tests.
// PRD #742 AC-10: missing session → null, no internal user → null,
// role != dev_admin → that role, role == dev_admin → 'dev_admin'.

import type { Role } from '@repo/shared/rbac';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Hoist the row buffer so `vi.mock`'s factory (which Vitest hoists to
 * the top of the file) can close over a stable reference. Each test
 * mutates `mockRows` before invoking `productionRoleLookup`.
 */
const { mockRows } = vi.hoisted(() => ({
  mockRows: { value: [] as ReadonlyArray<{ role: string }> },
}));

vi.mock('../../lib/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({ all: () => mockRows.value }),
        }),
      }),
    }),
  }),
}));

import {
  STYLEGUIDE_ROBOTS_HEADER,
  decideStyleguideAccess,
  lookupRoleBySubject,
  productionRoleLookup,
} from './_styleguide';

describe('decideStyleguideAccess', () => {
  it('redirects an anonymous caller to / with status 302', () => {
    const decision = decideStyleguideAccess({
      subjectId: null,
      roleLookup: () => 'dev_admin',
    });

    expect(decision).toEqual({ kind: 'redirect', to: '/', status: 302 });
  });

  it('redirects a signed-in caller with no internal row to / with status 302', () => {
    const decision = decideStyleguideAccess({
      subjectId: 'user_unknown',
      roleLookup: () => null,
    });

    expect(decision).toEqual({ kind: 'redirect', to: '/', status: 302 });
  });

  it.each<Role>([
    'member',
    'team_admin',
    'org_admin',
  ])('redirects a signed-in non-dev_admin (%s) to / with status 302', (role) => {
    const decision = decideStyleguideAccess({
      subjectId: 'user_x',
      roleLookup: () => role,
    });

    expect(decision).toEqual({ kind: 'redirect', to: '/', status: 302 });
  });

  it('allows a signed-in dev_admin to render the page', () => {
    const decision = decideStyleguideAccess({
      subjectId: 'user_dev_admin',
      roleLookup: () => 'dev_admin',
    });

    expect(decision).toEqual({ kind: 'allow' });
  });

  it('only consults the role lookup when the subject is signed in', () => {
    const calls: string[] = [];
    decideStyleguideAccess({
      subjectId: null,
      roleLookup: (id) => {
        calls.push(id);
        return 'dev_admin';
      },
    });

    expect(calls).toEqual([]);
  });
});

/**
 * Mock Drizzle handle. Mirrors the fluent select chain
 * `lookupRoleBySubject` exercises:
 *   `.select({ role }).from(users).where(...).limit(1).all()`
 * The terminal `.all()` returns the rows the test wires.
 */
function mockDbReturning(rows: ReadonlyArray<{ role: string }>): unknown {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({ all: () => rows }),
        }),
      }),
    }),
  };
}

describe('lookupRoleBySubject', () => {
  it('returns null when no internal user row matches the subject id (PRD #742 AC-10: no internal user → null)', () => {
    const db = mockDbReturning([]);
    expect(lookupRoleBySubject(db, 'user_no_row')).toBeNull();
  });

  it.each<Role>([
    'member',
    'team_admin',
    'org_admin',
  ])("returns the user's role verbatim when role != dev_admin (PRD #742 AC-10: role=%s)", (role) => {
    const db = mockDbReturning([{ role }]);
    expect(lookupRoleBySubject(db, 'user_x')).toBe(role);
  });

  it("returns 'dev_admin' when the user's role is dev_admin (PRD #742 AC-10)", () => {
    const db = mockDbReturning([{ role: 'dev_admin' }]);
    expect(lookupRoleBySubject(db, 'user_dev_admin')).toBe('dev_admin');
  });
});

/**
 * `productionRoleLookup` is the production wiring of `lookupRoleBySubject`
 * — it pulls the lazy Drizzle handle from `../../lib/db#getDb`. The
 * tests mock `../../lib/db` so the unit suite never touches a real
 * SQLite file. PRD #742 AC-10's "missing session → null" branch lives
 * in `decideStyleguideAccess` (covered above); the lookup itself only
 * sees a non-null subject because the .astro page guards on
 * `Astro.locals.auth().userId` before calling.
 */
describe('productionRoleLookup', () => {
  beforeEach(() => {
    mockRows.value = [];
  });

  it('returns null when the DB has no row for the subject (PRD #742 AC-10: no internal user → null)', () => {
    mockRows.value = [];
    expect(productionRoleLookup('user_unprovisioned')).toBeNull();
  });

  it("returns 'dev_admin' when the DB row's role is dev_admin (PRD #742 AC-10)", () => {
    mockRows.value = [{ role: 'dev_admin' }];
    expect(productionRoleLookup('user_seeded_dev_admin')).toBe('dev_admin');
  });

  it("returns the user's role verbatim when role != dev_admin (PRD #742 AC-10: role != dev_admin → that role)", () => {
    mockRows.value = [{ role: 'member' }];
    expect(productionRoleLookup('user_member')).toBe('member');
  });
});

describe('STYLEGUIDE_ROBOTS_HEADER', () => {
  it('pins the canonical noindex, nofollow header value', () => {
    expect(STYLEGUIDE_ROBOTS_HEADER).toBe('noindex, nofollow');
  });
});
