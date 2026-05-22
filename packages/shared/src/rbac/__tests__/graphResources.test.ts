/**
 * Focused unit suite for the Epic #9 RBAC extensions (Story #606).
 *
 * Complements the exhaustive cartesian sweep in `../policy.test.ts` by
 * pinning the explicit business intent for each new triple introduced
 * by Tech Spec #596:
 *
 *   - `coachAssignment` and `athleteMembership` join a `user` to a
 *     `team` within the actor's org. Cross-org reads/writes MUST
 *     return as if the resource does not exist (acceptance AC-4,
 *     AC-6, AC-8, AC-11 in #597).
 *   - `dev_admin` is allow-all; `org_admin` is `sameOrg`-scoped;
 *     `team_admin` is `sameTeam`-scoped; `member` (athlete) reads
 *     their own team's roster only.
 *
 * Every new `(role, resource, action)` triple — 4 roles × 2 new
 * resources × 5 actions = 40 triples — gets at least one positive
 * (same-org / same-team) and one negative (cross-org / cross-team)
 * case. The defensive `deny-by-default` branch is exercised for both
 * new resource names via runtime casts that simulate a deserialized
 * payload bypassing TypeScript.
 *
 * Pure unit tests: no DB, no fetch, no React. Lives at the unit
 * tier per `.agents/rules/testing-standards.md` § Assertion
 * Placement Rule.
 */

import { describe, expect, it } from 'vitest';
import { canPerform } from '../index';
import type { Action, RbacContext, Resource, Role } from '../types';

/**
 * Same-org actor reading a same-org resource. The shared baseline
 * the `sameOrg` predicate consults.
 */
const sameOrgCtx: RbacContext = {
  actorOrgId: 'org-A',
  resourceOrgId: 'org-A',
};

/**
 * Cross-org actor reading a different-org resource. Every guarded
 * triple MUST refuse this context.
 */
const crossOrgCtx: RbacContext = {
  actorOrgId: 'org-A',
  resourceOrgId: 'org-B',
};

/**
 * Same-org, same-team baseline. Used for `team_admin` and
 * `member` triples that go through `sameTeam`.
 */
const sameTeamCtx: RbacContext = {
  actorOrgId: 'org-A',
  resourceOrgId: 'org-A',
  actorTeamId: 'team-1',
  resourceTeamId: 'team-1',
};

/**
 * Same org but different team — pinpoints the `sameTeam` ↔ `sameOrg`
 * boundary for the `team_admin` and `member` triples.
 */
const crossTeamCtx: RbacContext = {
  actorOrgId: 'org-A',
  resourceOrgId: 'org-A',
  actorTeamId: 'team-1',
  resourceTeamId: 'team-2',
};

const GRAPH_RESOURCES = ['coachAssignment', 'athleteMembership'] as const satisfies ReadonlyArray<
  Extract<Resource, 'coachAssignment' | 'athleteMembership'>
>;

const ACTIONS: ReadonlyArray<Action> = ['create', 'read', 'update', 'delete', 'list'];

describe('rbac — Epic #9 graph resources × dev_admin', () => {
  for (const resource of GRAPH_RESOURCES) {
    for (const action of ACTIONS) {
      it(`${resource} / ${action} — same-org positive (allow-all)`, () => {
        expect(canPerform('dev_admin', resource, action, sameOrgCtx)).toBe(true);
      });

      it(`${resource} / ${action} — cross-org still allowed (platform root)`, () => {
        // dev_admin is allow-all by design — cross-org does NOT
        // change the verdict for the platform root. The cross-tenant
        // story for the root role lives in the persistence-layer
        // helper, not the policy.
        expect(canPerform('dev_admin', resource, action, crossOrgCtx)).toBe(true);
      });
    }
  }
});

describe('rbac — Epic #9 graph resources × org_admin', () => {
  for (const resource of GRAPH_RESOURCES) {
    for (const action of ACTIONS) {
      it(`${resource} / ${action} — same-org positive`, () => {
        expect(canPerform('org_admin', resource, action, sameOrgCtx)).toBe(true);
      });

      it(`${resource} / ${action} — cross-org refused`, () => {
        expect(canPerform('org_admin', resource, action, crossOrgCtx)).toBe(false);
      });
    }
  }
});

describe('rbac — Epic #9 graph resources × team_admin', () => {
  for (const resource of GRAPH_RESOURCES) {
    for (const action of ACTIONS) {
      it(`${resource} / ${action} — same-team positive`, () => {
        expect(canPerform('team_admin', resource, action, sameTeamCtx)).toBe(true);
      });

      it(`${resource} / ${action} — cross-team within same org refused`, () => {
        expect(canPerform('team_admin', resource, action, crossTeamCtx)).toBe(false);
      });

      it(`${resource} / ${action} — cross-org refused`, () => {
        expect(
          canPerform('team_admin', resource, action, {
            ...sameTeamCtx,
            resourceOrgId: 'org-B',
          }),
        ).toBe(false);
      });
    }
  }
});

describe('rbac — Epic #9 graph resources × member (athlete)', () => {
  // Athletes get sameTeam read/list and a hard deny on every
  // mutation. The positive case for read/list uses the same-team
  // context; the negative case crosses the team boundary.
  for (const resource of GRAPH_RESOURCES) {
    it(`${resource} / read — same-team positive (athletes see teammates and coaches)`, () => {
      expect(canPerform('member', resource, 'read', sameTeamCtx)).toBe(true);
    });

    it(`${resource} / read — cross-team within same org refused`, () => {
      expect(canPerform('member', resource, 'read', crossTeamCtx)).toBe(false);
    });

    it(`${resource} / list — same-team positive`, () => {
      expect(canPerform('member', resource, 'list', sameTeamCtx)).toBe(true);
    });

    it(`${resource} / list — cross-team refused`, () => {
      expect(canPerform('member', resource, 'list', crossTeamCtx)).toBe(false);
    });

    for (const action of ['create', 'update', 'delete'] as const) {
      it(`${resource} / ${action} — denied even with same-team context`, () => {
        // Mutations on the graph are an admin operation; the
        // athlete persona can never write to either table.
        expect(canPerform('member', resource, action, sameTeamCtx)).toBe(false);
      });
    }
  }
});

describe('rbac — Epic #9 graph resources: deny-by-default safeguard', () => {
  // Simulate a deserialized payload that bypassed the TypeScript
  // boundary for the new resource names. Both unknown action AND
  // unknown role should return false against the new resources.
  for (const resource of GRAPH_RESOURCES) {
    it(`${resource} — unknown action returns false`, () => {
      const unknownAction = 'archive' as Action;
      expect(canPerform('dev_admin', resource, unknownAction, {})).toBe(false);
    });

    it(`${resource} — unknown role returns false`, () => {
      const unknownRole = 'guest' as Role;
      expect(canPerform(unknownRole, resource, 'read', sameTeamCtx)).toBe(false);
    });
  }
});

describe('rbac — Epic #9 graph resources: purity', () => {
  it('does not mutate the supplied context for a graph-resource decision', () => {
    const ctx: RbacContext = {
      actorOrgId: 'org-A',
      resourceOrgId: 'org-A',
      actorTeamId: 'team-1',
      resourceTeamId: 'team-1',
    };
    const snapshot = JSON.stringify(ctx);
    canPerform('team_admin', 'coachAssignment', 'update', ctx);
    canPerform('member', 'athleteMembership', 'read', ctx);
    expect(JSON.stringify(ctx)).toBe(snapshot);
  });
});
