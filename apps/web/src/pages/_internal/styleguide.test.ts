// apps/web/src/pages/_internal/styleguide.test.ts
//
// Pure-function unit tests for the `/_internal/styleguide` gate. The
// gate is the only piece of the page exercised under Vitest — the
// `.astro` template wires the gate into Astro's request lifecycle.
//
// Story #723 / Task #734.

import type { Role } from '@repo/shared/rbac';
import { describe, expect, it } from 'vitest';
import {
  STYLEGUIDE_ROBOTS_HEADER,
  decideStyleguideAccess,
  productionRoleLookup,
} from './styleguide';

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

  it.each<Role>(['member', 'team_admin', 'org_admin'])(
    'redirects a signed-in non-dev_admin (%s) to / with status 302',
    (role) => {
      const decision = decideStyleguideAccess({
        subjectId: 'user_x',
        roleLookup: () => role,
      });

      expect(decision).toEqual({ kind: 'redirect', to: '/', status: 302 });
    },
  );

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

describe('productionRoleLookup', () => {
  it('returns null for every subject until the DB binding lands', () => {
    expect(productionRoleLookup('user_anything')).toBeNull();
    expect(productionRoleLookup('user_other')).toBeNull();
  });
});

describe('STYLEGUIDE_ROBOTS_HEADER', () => {
  it('pins the canonical noindex, nofollow header value', () => {
    expect(STYLEGUIDE_ROBOTS_HEADER).toBe('noindex, nofollow');
  });
});
