// packages/shared/src/rollover/buildPlan.test.ts
//
// Unit tests for the pure rollover-plan builder (Epic #10 / Story #665 /
// Task #697). Tier: unit. The module under test performs no I/O — these
// tests assert return values only, never wire shapes or DB state.

import { describe, expect, it } from 'vitest';
import { type MembershipSnapshot, type RolloverChoice, buildPlan } from './buildPlan';

const ORG = 'org_test_a';

function snap(
  id: string,
  teamId: string,
  athleteUserId: string,
  endedAt: Date | null = null,
): MembershipSnapshot {
  return { id, orgId: ORG, teamId, athleteUserId, endedAt };
}

describe('buildPlan', () => {
  it('returns empty collections when no choices are supplied', () => {
    const plan = buildPlan([snap('am_1', 't_a', 'u_ada')], []);
    expect(plan.archives).toEqual([]);
    expect(plan.promotions).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it('archives a membership for an archive decision', () => {
    const memberships = [snap('am_1', 't_a', 'u_ada')];
    const choices: RolloverChoice[] = [{ membershipId: 'am_1', decision: 'archive' }];
    const plan = buildPlan(memberships, choices);
    expect(plan.archives).toEqual([
      {
        membershipId: 'am_1',
        athleteUserId: 'u_ada',
        sourceTeamId: 't_a',
        reason: 'archive',
      },
    ]);
    expect(plan.promotions).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it('emits both an archive and a promotion for a promote decision', () => {
    const memberships = [snap('am_1', 't_u14', 'u_ada')];
    const choices: RolloverChoice[] = [
      { membershipId: 'am_1', decision: 'promote', targetTeamId: 't_u15' },
    ];
    const plan = buildPlan(memberships, choices);
    expect(plan.archives).toEqual([
      {
        membershipId: 'am_1',
        athleteUserId: 'u_ada',
        sourceTeamId: 't_u14',
        reason: 'promote',
      },
    ]);
    expect(plan.promotions).toEqual([
      {
        athleteUserId: 'u_ada',
        orgId: ORG,
        sourceTeamId: 't_u14',
        targetTeamId: 't_u15',
        reason: 'promote',
      },
    ]);
    expect(plan.errors).toEqual([]);
  });

  it('emits both an archive and a promotion for a transfer decision and preserves the reason', () => {
    const memberships = [snap('am_1', 't_a', 'u_ada')];
    const choices: RolloverChoice[] = [
      { membershipId: 'am_1', decision: 'transfer', targetTeamId: 't_b' },
    ];
    const plan = buildPlan(memberships, choices);
    expect(plan.archives[0]?.reason).toBe('transfer');
    expect(plan.promotions[0]?.reason).toBe('transfer');
    expect(plan.promotions[0]?.targetTeamId).toBe('t_b');
  });

  it('treats an omitted membership as a no-op (no choice → no write)', () => {
    const memberships = [snap('am_1', 't_a', 'u_ada'), snap('am_2', 't_a', 'u_grace')];
    // Only decide on am_1; am_2 is left alone.
    const choices: RolloverChoice[] = [{ membershipId: 'am_1', decision: 'archive' }];
    const plan = buildPlan(memberships, choices);
    expect(plan.archives).toHaveLength(1);
    expect(plan.archives[0]?.membershipId).toBe('am_1');
    expect(plan.promotions).toEqual([]);
  });

  it('reports UNKNOWN_MEMBERSHIP for a choice that references no current row, without throwing', () => {
    const memberships = [snap('am_1', 't_a', 'u_ada')];
    const choices: RolloverChoice[] = [{ membershipId: 'am_ghost', decision: 'archive' }];
    expect(() => buildPlan(memberships, choices)).not.toThrow();
    const plan = buildPlan(memberships, choices);
    expect(plan.archives).toEqual([]);
    expect(plan.errors).toEqual([{ membershipId: 'am_ghost', code: 'UNKNOWN_MEMBERSHIP' }]);
  });

  it('reports MISSING_TARGET_TEAM for a promote/transfer decision with no target', () => {
    const memberships = [snap('am_1', 't_a', 'u_ada'), snap('am_2', 't_a', 'u_grace')];
    const choices: RolloverChoice[] = [
      { membershipId: 'am_1', decision: 'promote' },
      { membershipId: 'am_2', decision: 'transfer', targetTeamId: '' },
    ];
    const plan = buildPlan(memberships, choices);
    expect(plan.archives).toEqual([]);
    expect(plan.promotions).toEqual([]);
    expect(plan.errors).toEqual([
      { membershipId: 'am_1', code: 'MISSING_TARGET_TEAM' },
      { membershipId: 'am_2', code: 'MISSING_TARGET_TEAM' },
    ]);
  });

  it('reports ALREADY_ENDED for a decision against an end-dated row', () => {
    const memberships = [snap('am_1', 't_a', 'u_ada', new Date('2024-06-01T00:00:00Z'))];
    const choices: RolloverChoice[] = [{ membershipId: 'am_1', decision: 'archive' }];
    const plan = buildPlan(memberships, choices);
    expect(plan.archives).toEqual([]);
    expect(plan.errors).toEqual([{ membershipId: 'am_1', code: 'ALREADY_ENDED' }]);
  });

  it('produces a deterministic ordering across input permutations (stale-plan invariant)', () => {
    const memberships = [
      snap('am_z', 't_a', 'u_z'),
      snap('am_a', 't_a', 'u_a'),
      snap('am_m', 't_a', 'u_m'),
    ];
    const choicesA: RolloverChoice[] = [
      { membershipId: 'am_z', decision: 'archive' },
      { membershipId: 'am_a', decision: 'promote', targetTeamId: 't_b' },
      { membershipId: 'am_m', decision: 'archive' },
    ];
    const choicesB: RolloverChoice[] = [
      { membershipId: 'am_a', decision: 'promote', targetTeamId: 't_b' },
      { membershipId: 'am_m', decision: 'archive' },
      { membershipId: 'am_z', decision: 'archive' },
    ];
    expect(buildPlan(memberships, choicesA)).toEqual(buildPlan(memberships, choicesB));
  });

  it('handles a mixed plan: promote + archive + transfer in one batch', () => {
    const memberships = [
      snap('am_1', 't_u14', 'u_ada'),
      snap('am_2', 't_u14', 'u_grace'),
      snap('am_3', 't_u14', 'u_marie'),
    ];
    const choices: RolloverChoice[] = [
      { membershipId: 'am_1', decision: 'promote', targetTeamId: 't_u15' },
      { membershipId: 'am_2', decision: 'archive' },
      { membershipId: 'am_3', decision: 'transfer', targetTeamId: 't_u14_b' },
    ];
    const plan = buildPlan(memberships, choices);
    expect(plan.archives).toHaveLength(3);
    expect(plan.promotions).toHaveLength(2);
    expect(plan.errors).toHaveLength(0);
    // Reasons preserved per source row.
    const byId = new Map(plan.archives.map((a) => [a.membershipId, a.reason]));
    expect(byId.get('am_1')).toBe('promote');
    expect(byId.get('am_2')).toBe('archive');
    expect(byId.get('am_3')).toBe('transfer');
  });

  it('performs no DB or network I/O (the function is pure and synchronous)', () => {
    // The signature itself is synchronous; if it ever becomes async this
    // assertion guards against an accidental side-effect import.
    const result = buildPlan(
      [snap('am_1', 't_a', 'u_ada')],
      [{ membershipId: 'am_1', decision: 'archive' }],
    );
    expect(result).toBeDefined();
    expect(typeof (result as unknown as Promise<unknown>).then).toBe('undefined');
  });
});
