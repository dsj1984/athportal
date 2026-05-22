// packages/baselines/src/compare.test.ts
//
// Unit suite for `compareWithTolerance` covering one happy-path and
// one negative-path per ToleranceSpec kind plus the hard-cap
// warn/fail thresholds called out in the Tech Spec.

import { describe, expect, it } from 'vitest';
import { compareWithTolerance, evaluate } from './compare.js';
import type { BaselineEnvelope } from './types.js';

type CovRow = { path: string; lines: number };
type CovRollup = { lines: number };

function envOf(rows: CovRow[]): BaselineEnvelope<CovRow, CovRollup> {
  return {
    $schema: '.agents/schemas/baselines/coverage.schema.json',
    kernelVersion: '1.0.0',
    generatedAt: '2026-05-17T00:00:00.000Z',
    rollup: { '*': { lines: 0 } },
    rows,
  };
}

describe('evaluate', () => {
  describe('absolute-pp (higher-is-better, coverage-shaped)', () => {
    it('passes when next is inside the tolerance window', () => {
      expect(evaluate({ kind: 'absolute-pp', pp: 2 }, 90, 89, 'higher-is-better')).toBeNull();
    });
    it('fails when next falls more than pp below prev', () => {
      expect(evaluate({ kind: 'absolute-pp', pp: 2 }, 90, 87, 'higher-is-better')).toBe('fail');
    });
    it('passes at the exact boundary (next = prev - pp)', () => {
      // The check is strict-less-than, so equality is conforming.
      expect(evaluate({ kind: 'absolute-pp', pp: 2 }, 90, 88, 'higher-is-better')).toBeNull();
    });
    it('defaults polarity to higher-is-better when undefined (coverage caller)', () => {
      expect(evaluate({ kind: 'absolute-pp', pp: 2 }, 90, 87, undefined)).toBe('fail');
      expect(evaluate({ kind: 'absolute-pp', pp: 2 }, 90, 89, undefined)).toBeNull();
    });
  });

  describe('absolute-pp (lower-is-better)', () => {
    it('fails when next rises more than pp above prev', () => {
      expect(evaluate({ kind: 'absolute-pp', pp: 2 }, 5, 8, 'lower-is-better')).toBe('fail');
    });
    it('passes when next stays inside the upward band', () => {
      expect(evaluate({ kind: 'absolute-pp', pp: 2 }, 5, 7, 'lower-is-better')).toBeNull();
    });
  });

  describe('relative-pct (higher-is-better, mutation-shaped)', () => {
    it('passes when next is inside the percentage window', () => {
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 80, 77, 'higher-is-better')).toBeNull();
    });
    it('fails on a relative drop greater than pct%', () => {
      // 5% of 80 = 4. 80 → 75 is a 5-point drop → fail.
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 80, 75, 'higher-is-better')).toBe('fail');
    });
    it('passes at the exact boundary (next = prev - pct%·prev)', () => {
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 80, 76, 'higher-is-better')).toBeNull();
    });
    it('treats prev=0 as a free pass for higher-is-better axes', () => {
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 0, 1, 'higher-is-better')).toBeNull();
    });
    it('treats prev=0 as a fail when lower-is-better and next>0', () => {
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 0, 1, 'lower-is-better')).toBe('fail');
    });
    it('treats prev=0 and next=0 as conforming for lower-is-better', () => {
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 0, 0, 'lower-is-better')).toBeNull();
    });
    it('defaults polarity to higher-is-better when undefined (mutation caller)', () => {
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 80, 75, undefined)).toBe('fail');
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 80, 77, undefined)).toBeNull();
    });
  });

  describe('relative-pct (lower-is-better, CRAP-shaped)', () => {
    it('fails on a relative rise greater than pct%', () => {
      // 5% of 100 = 5. 100 → 106 is a 6-point rise → fail.
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 100, 106, 'lower-is-better')).toBe('fail');
    });
    it('passes inside the upward band', () => {
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, 100, 104, 'lower-is-better')).toBeNull();
    });
    it('uses |prev| for the allowance (negative prev path)', () => {
      // 5% of |−100| = 5. next = −94 is +6 above prev → fail.
      expect(evaluate({ kind: 'relative-pct', pct: 5 }, -100, -94, 'lower-is-better')).toBe('fail');
    });
  });

  describe('absolute-int (lower-is-better, lint-warning-shaped)', () => {
    it('passes when next is within delta', () => {
      expect(evaluate({ kind: 'absolute-int', delta: 0 }, 3, 3, 'lower-is-better')).toBeNull();
    });
    it('fails on any increase when delta=0', () => {
      expect(evaluate({ kind: 'absolute-int', delta: 0 }, 3, 4, 'lower-is-better')).toBe('fail');
    });
    it('allows an increase up to delta', () => {
      expect(evaluate({ kind: 'absolute-int', delta: 2 }, 3, 5, 'lower-is-better')).toBeNull();
      expect(evaluate({ kind: 'absolute-int', delta: 2 }, 3, 6, 'lower-is-better')).toBe('fail');
    });
    it('defaults polarity to lower-is-better when undefined', () => {
      expect(evaluate({ kind: 'absolute-int', delta: 0 }, 3, 4, undefined)).toBe('fail');
      expect(evaluate({ kind: 'absolute-int', delta: 0 }, 3, 3, undefined)).toBeNull();
    });
  });

  describe('absolute-int (higher-is-better, MI-floor-shaped)', () => {
    it('fails on a drop greater than delta', () => {
      expect(evaluate({ kind: 'absolute-int', delta: 0 }, 80, 79, 'higher-is-better')).toBe('fail');
    });
    it('passes inside the downward band', () => {
      expect(evaluate({ kind: 'absolute-int', delta: 2 }, 80, 78, 'higher-is-better')).toBeNull();
      expect(evaluate({ kind: 'absolute-int', delta: 2 }, 80, 77, 'higher-is-better')).toBe('fail');
    });
  });

  describe('hard-cap (bundle-size 1 MiB Worker contract)', () => {
    const ONE_MIB = 1_048_576;
    const tolerance = { kind: 'hard-cap' as const, cap: ONE_MIB, warnPct: 0.9 };

    it('passes below the warn band', () => {
      expect(evaluate(tolerance, 0, 0.5 * ONE_MIB, undefined)).toBeNull();
    });
    it('warns at 90% of the cap', () => {
      expect(evaluate(tolerance, 0, 0.9 * ONE_MIB, undefined)).toBe('warn');
    });
    it('warns between the warn band and the cap', () => {
      expect(evaluate(tolerance, 0, 0.95 * ONE_MIB, undefined)).toBe('warn');
    });
    it('fails at 100% of the cap', () => {
      expect(evaluate(tolerance, 0, ONE_MIB, undefined)).toBe('fail');
    });
    it('fails above the cap', () => {
      expect(evaluate(tolerance, 0, ONE_MIB + 1, undefined)).toBe('fail');
    });
  });

  describe('route-band (lighthouse ±3)', () => {
    const tolerance = { kind: 'route-band' as const, plusMinus: 3 };

    it('passes inside the band in either direction', () => {
      expect(evaluate(tolerance, 90, 88, undefined)).toBeNull();
      expect(evaluate(tolerance, 90, 92, undefined)).toBeNull();
    });
    it('fails on a drop past the band', () => {
      expect(evaluate(tolerance, 90, 86, undefined)).toBe('fail');
    });
    it('fails on a rise past the band', () => {
      expect(evaluate(tolerance, 90, 94, undefined)).toBe('fail');
    });
  });
});

describe('compareWithTolerance', () => {
  it('returns an empty array on full conformance', () => {
    const prev = envOf([{ path: 'apps/api/src/a.ts', lines: 90 }]);
    const next = envOf([{ path: 'apps/api/src/a.ts', lines: 89 }]);
    const diffs = compareWithTolerance(
      prev,
      next,
      { kind: 'absolute-pp', pp: 2 },
      {
        axes: ['lines'],
        polarity: 'higher-is-better',
      },
    );
    expect(diffs).toEqual([]);
  });

  it('emits one Diff per axis-violation', () => {
    const prev = envOf([
      { path: 'apps/api/src/a.ts', lines: 90 },
      { path: 'apps/api/src/b.ts', lines: 80 },
    ]);
    const next = envOf([
      { path: 'apps/api/src/a.ts', lines: 87 }, // fails (drop of 3 > pp=2)
      { path: 'apps/api/src/b.ts', lines: 79 }, // passes (drop of 1 ≤ pp=2)
    ]);
    const diffs = compareWithTolerance(
      prev,
      next,
      { kind: 'absolute-pp', pp: 2 },
      {
        axes: ['lines'],
        polarity: 'higher-is-better',
      },
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      identifier: 'apps/api/src/a.ts',
      axis: 'lines',
      prev: 90,
      next: 87,
      severity: 'fail',
    });
  });

  it('treats rows present in prev but absent in next as deletions (no Diff)', () => {
    const prev = envOf([{ path: 'apps/api/src/a.ts', lines: 90 }]);
    const next = envOf([]);
    const diffs = compareWithTolerance(
      prev,
      next,
      { kind: 'absolute-pp', pp: 2 },
      {
        axes: ['lines'],
        polarity: 'higher-is-better',
      },
    );
    expect(diffs).toEqual([]);
  });

  it('compares new rows (absent in prev) against an implicit 0', () => {
    const prev = envOf([]);
    const next = envOf([{ path: 'apps/api/src/new.ts', lines: 95 }]);
    // higher-is-better + prev implicit 0 → gain is not a regression.
    const diffs = compareWithTolerance(
      prev,
      next,
      { kind: 'absolute-pp', pp: 2 },
      {
        axes: ['lines'],
        polarity: 'higher-is-better',
      },
    );
    expect(diffs).toEqual([]);
  });

  it('respects a custom identifierKey (lighthouse `route`)', () => {
    type LhRow = { route: string; performance: number };
    type LhRoll = { performance: number };
    function lhEnv(rows: LhRow[]): BaselineEnvelope<LhRow, LhRoll> {
      return {
        $schema: '.agents/schemas/baselines/lighthouse.schema.json',
        kernelVersion: '1.0.0',
        generatedAt: '2026-05-17T00:00:00.000Z',
        rollup: { '*': { performance: 0 } },
        rows,
      };
    }
    const prev = lhEnv([{ route: '/', performance: 90 }]);
    const next = lhEnv([{ route: '/', performance: 84 }]);
    const diffs = compareWithTolerance<LhRow, LhRoll>(
      prev,
      next,
      {
        kind: 'route-band',
        plusMinus: 3,
      },
      { identifierKey: 'route', axes: ['performance'] },
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.identifier).toBe('/');
  });
});
