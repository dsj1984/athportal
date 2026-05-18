/**
 * Exhaustive unit suite for the RBAC policy (Story #327, Epic #7).
 *
 * Two layers of coverage:
 *
 * 1. **Cartesian sweep** — every `(role, resource, action)` triple is
 *    enumerated and tested with a positive AND negative case. The
 *    expected verdict for each triple is encoded once in this file
 *    (the `EXPECTED` table) so changing a rule in `rules.ts` requires
 *    a matching test edit — never a silent drift. The sweep also
 *    asserts the rules table has *exactly one* row per triple (no
 *    holes, no duplicates).
 *
 * 2. **Predicate branch coverage** — `sameOrg`, `sameTeam`, `isOwner`,
 *    `lastAdminGuard`, and `sameOrgWithLastAdmin` each have explicit
 *    tests that flip every boolean input so v8 records every branch.
 *    The package's `vitest.config.ts` pins `src/rbac/**` at ≥95%
 *    branches.
 *
 * The suite is a pure unit test: no DB, no fetch, no React rendering.
 * It exercises only the policy module and the rules data.
 */

import { describe, expect, it } from 'vitest';
import {
  RULES,
  allow,
  canPerform,
  deny,
  findRule,
  isOwner,
  lastAdminGuard,
  sameOrg,
  sameOrgWithLastAdmin,
  sameTeam,
} from './index';
import { buildRuleIndex } from './rules';
import type { Action, RbacContext, Resource, Role } from './types';

const ROLES: ReadonlyArray<Role> = ['dev_admin', 'org_admin', 'team_admin', 'member'];

const RESOURCES: ReadonlyArray<Resource> = ['organization', 'team', 'user', 'invitation'];

const ACTIONS: ReadonlyArray<Action> = ['create', 'read', 'update', 'delete', 'list'];

/**
 * The set of context-guard shapes used in the rules table. Naming
 * matches the predicate so the EXPECTED table is human-scannable.
 */
type Shape =
  | 'allow'
  | 'deny'
  | 'sameOrg'
  | 'sameTeam'
  | 'isOwner'
  | 'lastAdmin'
  | 'sameOrgWithLastAdmin';

/**
 * Encoding of the rules table from the test's perspective.
 *
 * If you change a row in `rules.ts`, you MUST change the matching
 * cell here. That's the point: this table is the second pair of
 * eyes on every business rule.
 */
const EXPECTED: Record<Role, Record<Resource, Record<Action, Shape>>> = {
  dev_admin: {
    organization: {
      create: 'allow',
      read: 'allow',
      update: 'allow',
      delete: 'allow',
      list: 'allow',
    },
    team: {
      create: 'allow',
      read: 'allow',
      update: 'allow',
      delete: 'allow',
      list: 'allow',
    },
    user: {
      create: 'allow',
      read: 'allow',
      update: 'lastAdmin',
      delete: 'lastAdmin',
      list: 'allow',
    },
    invitation: {
      create: 'allow',
      read: 'allow',
      update: 'allow',
      delete: 'allow',
      list: 'allow',
    },
  },
  org_admin: {
    organization: {
      create: 'deny',
      read: 'sameOrg',
      update: 'sameOrg',
      delete: 'deny',
      list: 'allow',
    },
    team: {
      create: 'sameOrg',
      read: 'sameOrg',
      update: 'sameOrg',
      delete: 'sameOrg',
      list: 'sameOrg',
    },
    user: {
      create: 'sameOrg',
      read: 'sameOrg',
      update: 'sameOrgWithLastAdmin',
      delete: 'sameOrgWithLastAdmin',
      list: 'sameOrg',
    },
    invitation: {
      create: 'sameOrg',
      read: 'sameOrg',
      update: 'sameOrg',
      delete: 'sameOrg',
      list: 'sameOrg',
    },
  },
  team_admin: {
    organization: {
      create: 'deny',
      read: 'sameOrg',
      update: 'deny',
      delete: 'deny',
      list: 'deny',
    },
    team: {
      create: 'deny',
      read: 'sameTeam',
      update: 'sameTeam',
      delete: 'deny',
      list: 'sameOrg',
    },
    user: {
      create: 'deny',
      read: 'sameTeam',
      update: 'deny',
      delete: 'deny',
      list: 'sameTeam',
    },
    invitation: {
      create: 'sameTeam',
      read: 'sameTeam',
      update: 'sameTeam',
      delete: 'sameTeam',
      list: 'sameTeam',
    },
  },
  member: {
    organization: {
      create: 'deny',
      read: 'sameOrg',
      update: 'deny',
      delete: 'deny',
      list: 'deny',
    },
    team: {
      create: 'deny',
      read: 'sameTeam',
      update: 'deny',
      delete: 'deny',
      list: 'deny',
    },
    user: {
      create: 'deny',
      read: 'sameTeam',
      update: 'isOwner',
      delete: 'deny',
      list: 'deny',
    },
    invitation: {
      create: 'deny',
      read: 'isOwner',
      update: 'deny',
      delete: 'deny',
      list: 'deny',
    },
  },
};

/**
 * Two contexts per shape: one that satisfies the guard (positive),
 * one that does not (negative). Used by the cartesian sweep.
 */
const POSITIVE_CTX: Record<Shape, RbacContext> = {
  allow: {},
  deny: {},
  sameOrg: { actorOrgId: 'org-A', resourceOrgId: 'org-A' },
  sameTeam: {
    actorOrgId: 'org-A',
    resourceOrgId: 'org-A',
    actorTeamId: 'team-1',
    resourceTeamId: 'team-1',
  },
  isOwner: { actorId: 'user-1', resourceOwnerId: 'user-1' },
  lastAdmin: { remainingAdminsAfter: 1 },
  sameOrgWithLastAdmin: {
    actorOrgId: 'org-A',
    resourceOrgId: 'org-A',
    remainingAdminsAfter: 1,
  },
};

const NEGATIVE_CTX: Record<Shape, RbacContext> = {
  // Unconditional allow has no negative case — express it as the
  // policy still returning true regardless of the context shape.
  allow: { actorOrgId: 'org-A', resourceOrgId: 'org-B' },
  // Unconditional deny is symmetrical.
  deny: { actorOrgId: 'org-A', resourceOrgId: 'org-A' },
  sameOrg: { actorOrgId: 'org-A', resourceOrgId: 'org-B' },
  sameTeam: {
    actorOrgId: 'org-A',
    resourceOrgId: 'org-A',
    actorTeamId: 'team-1',
    resourceTeamId: 'team-2',
  },
  isOwner: { actorId: 'user-1', resourceOwnerId: 'user-2' },
  lastAdmin: { remainingAdminsAfter: 0 },
  sameOrgWithLastAdmin: {
    actorOrgId: 'org-A',
    resourceOrgId: 'org-A',
    remainingAdminsAfter: 0,
  },
};

/**
 * Expected verdict for the positive/negative ctx, by shape.
 */
const POSITIVE_VERDICT: Record<Shape, boolean> = {
  allow: true,
  deny: false,
  sameOrg: true,
  sameTeam: true,
  isOwner: true,
  lastAdmin: true,
  sameOrgWithLastAdmin: true,
};

const NEGATIVE_VERDICT: Record<Shape, boolean> = {
  allow: true, // unconditional allow stays true
  deny: false,
  sameOrg: false,
  sameTeam: false,
  isOwner: false,
  lastAdmin: false,
  sameOrgWithLastAdmin: false,
};

describe('rbac/rules — table integrity', () => {
  it('has exactly one rule per (role, resource, action) triple', () => {
    expect(RULES.length).toBe(ROLES.length * RESOURCES.length * ACTIONS.length);
  });

  it('contains every triple from the cartesian product', () => {
    for (const role of ROLES) {
      for (const resource of RESOURCES) {
        for (const action of ACTIONS) {
          const rule = findRule({ role, resource, action });
          expect(rule, `missing rule: ${role}/${resource}/${action}`).toBeDefined();
        }
      }
    }
  });

  it('contains no duplicate triples', () => {
    const seen = new Set<string>();
    for (const r of RULES) {
      const key = `${r.role}|${r.resource}|${r.action}`;
      expect(seen.has(key), `duplicate rule: ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('buildRuleIndex throws on a duplicate triple (authoring guard)', () => {
    expect(() =>
      buildRuleIndex([
        {
          role: 'dev_admin',
          resource: 'organization',
          action: 'read',
          predicate: allow,
        },
        {
          role: 'dev_admin',
          resource: 'organization',
          action: 'read',
          predicate: deny,
        },
      ]),
    ).toThrow(/duplicate rule/);
  });

  it('buildRuleIndex returns a map keyed by role|resource|action', () => {
    const idx = buildRuleIndex([
      {
        role: 'member',
        resource: 'team',
        action: 'read',
        predicate: sameTeam,
      },
    ]);
    expect(idx.get('member|team|read')?.predicate).toBe(sameTeam);
    expect(idx.size).toBe(1);
  });
});

describe('canPerform — cartesian sweep (positive + negative per triple)', () => {
  for (const role of ROLES) {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        const shape = EXPECTED[role][resource][action];

        it(`${role} / ${resource} / ${action} — positive (${shape})`, () => {
          expect(canPerform(role, resource, action, POSITIVE_CTX[shape])).toBe(
            POSITIVE_VERDICT[shape],
          );
        });

        it(`${role} / ${resource} / ${action} — negative (${shape})`, () => {
          expect(canPerform(role, resource, action, NEGATIVE_CTX[shape])).toBe(
            NEGATIVE_VERDICT[shape],
          );
        });
      }
    }
  }
});

describe('canPerform — deny-by-default safeguard', () => {
  it('returns false when the triple is unknown at runtime', () => {
    // Force an unknown triple via cast to simulate a deserialized
    // payload that bypassed the TypeScript boundary.
    const unknownRole = 'super_admin' as Role;
    expect(canPerform(unknownRole, 'organization', 'read', {})).toBe(false);
  });

  it('returns false when the resource is unknown at runtime', () => {
    const unknownResource = 'invoice' as Resource;
    expect(canPerform('dev_admin', unknownResource, 'read', {})).toBe(false);
  });

  it('returns false when the action is unknown at runtime', () => {
    const unknownAction = 'archive' as Action;
    expect(canPerform('dev_admin', 'organization', unknownAction, {})).toBe(false);
  });
});

describe('predicates — boolean branch coverage', () => {
  describe('allow', () => {
    it('returns true regardless of context', () => {
      expect(allow({})).toBe(true);
      expect(allow({ actorOrgId: 'x' })).toBe(true);
    });
  });

  describe('deny', () => {
    it('returns false regardless of context', () => {
      expect(deny({})).toBe(false);
      expect(deny({ actorOrgId: 'x' })).toBe(false);
    });
  });

  describe('sameOrg', () => {
    it('returns true when both org ids match and are non-empty', () => {
      expect(sameOrg({ actorOrgId: 'org-A', resourceOrgId: 'org-A' })).toBe(true);
    });

    it('returns false when org ids differ', () => {
      expect(sameOrg({ actorOrgId: 'org-A', resourceOrgId: 'org-B' })).toBe(false);
    });

    it('returns false when actorOrgId is missing', () => {
      expect(sameOrg({ resourceOrgId: 'org-A' })).toBe(false);
    });

    it('returns false when resourceOrgId is missing', () => {
      expect(sameOrg({ actorOrgId: 'org-A' })).toBe(false);
    });

    it('returns false when both are missing', () => {
      expect(sameOrg({})).toBe(false);
    });

    it('returns false when actorOrgId is empty string', () => {
      expect(sameOrg({ actorOrgId: '', resourceOrgId: 'org-A' })).toBe(false);
    });

    it('returns false when resourceOrgId is empty string', () => {
      expect(sameOrg({ actorOrgId: 'org-A', resourceOrgId: '' })).toBe(false);
    });
  });

  describe('sameTeam', () => {
    it('returns true when both org and team ids match', () => {
      expect(
        sameTeam({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-A',
          actorTeamId: 'team-1',
          resourceTeamId: 'team-1',
        }),
      ).toBe(true);
    });

    it('returns false when team ids differ even if orgs match', () => {
      expect(
        sameTeam({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-A',
          actorTeamId: 'team-1',
          resourceTeamId: 'team-2',
        }),
      ).toBe(false);
    });

    it('returns false when orgs differ even if team ids match', () => {
      expect(
        sameTeam({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-B',
          actorTeamId: 'team-1',
          resourceTeamId: 'team-1',
        }),
      ).toBe(false);
    });

    it('returns false when actorTeamId is missing', () => {
      expect(
        sameTeam({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-A',
          resourceTeamId: 'team-1',
        }),
      ).toBe(false);
    });

    it('returns false when resourceTeamId is missing', () => {
      expect(
        sameTeam({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-A',
          actorTeamId: 'team-1',
        }),
      ).toBe(false);
    });

    it('returns false on empty team-id strings', () => {
      expect(
        sameTeam({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-A',
          actorTeamId: '',
          resourceTeamId: 'team-1',
        }),
      ).toBe(false);
    });
  });

  describe('isOwner', () => {
    it('returns true when actorId matches resourceOwnerId', () => {
      expect(isOwner({ actorId: 'user-1', resourceOwnerId: 'user-1' })).toBe(true);
    });

    it('returns false when ids differ', () => {
      expect(isOwner({ actorId: 'user-1', resourceOwnerId: 'user-2' })).toBe(false);
    });

    it('returns false when actorId is missing', () => {
      expect(isOwner({ resourceOwnerId: 'user-1' })).toBe(false);
    });

    it('returns false when resourceOwnerId is missing', () => {
      expect(isOwner({ actorId: 'user-1' })).toBe(false);
    });

    it('returns false when both are missing', () => {
      expect(isOwner({})).toBe(false);
    });

    it('returns false on empty actorId', () => {
      expect(isOwner({ actorId: '', resourceOwnerId: 'user-1' })).toBe(false);
    });

    it('returns false on empty resourceOwnerId', () => {
      expect(isOwner({ actorId: 'user-1', resourceOwnerId: '' })).toBe(false);
    });
  });

  describe('lastAdminGuard', () => {
    it('returns true when remainingAdminsAfter > 0', () => {
      expect(lastAdminGuard({ remainingAdminsAfter: 1 })).toBe(true);
      expect(lastAdminGuard({ remainingAdminsAfter: 42 })).toBe(true);
    });

    it('returns false when remainingAdminsAfter is exactly 0', () => {
      expect(lastAdminGuard({ remainingAdminsAfter: 0 })).toBe(false);
    });

    it('returns false when remainingAdminsAfter is negative (defensive)', () => {
      expect(lastAdminGuard({ remainingAdminsAfter: -1 })).toBe(false);
    });

    it('returns false when remainingAdminsAfter is undefined', () => {
      expect(lastAdminGuard({})).toBe(false);
    });

    it('returns false when remainingAdminsAfter is the wrong type', () => {
      // Defensive: a caller passing a string (e.g. unparsed query
      // param) must NOT pass the guard.
      const ctx = { remainingAdminsAfter: '1' as unknown as number };
      expect(lastAdminGuard(ctx)).toBe(false);
    });
  });

  describe('sameOrgWithLastAdmin', () => {
    it('returns true when both clauses hold', () => {
      expect(
        sameOrgWithLastAdmin({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-A',
          remainingAdminsAfter: 2,
        }),
      ).toBe(true);
    });

    it('returns false when org scope fails (short-circuit)', () => {
      expect(
        sameOrgWithLastAdmin({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-B',
          remainingAdminsAfter: 2,
        }),
      ).toBe(false);
    });

    it('returns false when last-admin guard fails', () => {
      expect(
        sameOrgWithLastAdmin({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-A',
          remainingAdminsAfter: 0,
        }),
      ).toBe(false);
    });

    it('returns false when remainingAdminsAfter is missing', () => {
      expect(
        sameOrgWithLastAdmin({
          actorOrgId: 'org-A',
          resourceOrgId: 'org-A',
        }),
      ).toBe(false);
    });
  });
});

describe('canPerform — last-admin invariant (Story #340)', () => {
  it('refuses an org_admin user.update that would drop the last admin', () => {
    expect(
      canPerform('org_admin', 'user', 'update', {
        actorOrgId: 'org-A',
        resourceOrgId: 'org-A',
        remainingAdminsAfter: 0,
      }),
    ).toBe(false);
  });

  it('allows an org_admin user.update when at least one admin remains', () => {
    expect(
      canPerform('org_admin', 'user', 'update', {
        actorOrgId: 'org-A',
        resourceOrgId: 'org-A',
        remainingAdminsAfter: 1,
      }),
    ).toBe(true);
  });

  it('refuses an org_admin user.delete that would drop the last admin', () => {
    expect(
      canPerform('org_admin', 'user', 'delete', {
        actorOrgId: 'org-A',
        resourceOrgId: 'org-A',
        remainingAdminsAfter: 0,
      }),
    ).toBe(false);
  });

  it('refuses when remainingAdminsAfter is not supplied (org_admin path)', () => {
    expect(
      canPerform('org_admin', 'user', 'update', {
        actorOrgId: 'org-A',
        resourceOrgId: 'org-A',
      }),
    ).toBe(false);
  });

  it('refuses a dev_admin user.update that would drop the last admin', () => {
    // The platform root still cannot break the last-admin invariant
    // — even allow-all roles are gated by this rule (Tech Spec #318
    // §E).
    expect(
      canPerform('dev_admin', 'user', 'update', {
        remainingAdminsAfter: 0,
      }),
    ).toBe(false);
  });

  it('allows a dev_admin user.update when at least one admin remains', () => {
    expect(
      canPerform('dev_admin', 'user', 'update', {
        remainingAdminsAfter: 1,
      }),
    ).toBe(true);
  });

  it('refuses a dev_admin user.delete that would drop the last admin', () => {
    expect(
      canPerform('dev_admin', 'user', 'delete', {
        remainingAdminsAfter: 0,
      }),
    ).toBe(false);
  });

  it('allows a dev_admin user.delete when at least one admin remains', () => {
    expect(
      canPerform('dev_admin', 'user', 'delete', {
        remainingAdminsAfter: 2,
      }),
    ).toBe(true);
  });

  it('refuses a dev_admin user.update when remainingAdminsAfter is not supplied', () => {
    expect(canPerform('dev_admin', 'user', 'update', {})).toBe(false);
  });
});

describe('canPerform — purity', () => {
  it('does not mutate the supplied context', () => {
    const ctx: RbacContext = {
      actorOrgId: 'org-A',
      resourceOrgId: 'org-A',
      remainingAdminsAfter: 2,
    };
    const snapshot = JSON.stringify(ctx);
    canPerform('org_admin', 'user', 'update', ctx);
    expect(JSON.stringify(ctx)).toBe(snapshot);
  });

  it('returns the same verdict for repeated calls with the same inputs', () => {
    const ctx: RbacContext = { actorOrgId: 'org-A', resourceOrgId: 'org-A' };
    const a = canPerform('org_admin', 'team', 'read', ctx);
    const b = canPerform('org_admin', 'team', 'read', ctx);
    expect(a).toBe(b);
  });
});
