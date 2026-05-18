// packages/baselines/src/format.test.ts
//
// Unit suite for `formatRejectionMessage`. Pins:
//   - empty diffs return an empty string
//   - single-violation rendering names kind, identifier, axis,
//     prev → next, and the tolerance kind+params
//   - hard-cap emits both warn and fail severities and the summary
//     splits the counts

import { describe, expect, it } from 'vitest';
import { formatRejectionMessage } from './format.js';
import type { Diff, ToleranceSpec } from './types.js';

describe('formatRejectionMessage', () => {
  it('returns an empty string on no diffs', () => {
    expect(formatRejectionMessage('lint', [])).toBe('');
  });

  it('renders kind, identifier, axis, prev/next, and tolerance for a single fail', () => {
    const tol: ToleranceSpec = { kind: 'absolute-pp', pp: 2 };
    const diff: Diff = {
      identifier: 'apps/api/src/a.ts',
      axis: 'lines',
      prev: 90,
      next: 87,
      tolerance: tol,
      severity: 'fail',
    };
    const out = formatRejectionMessage('coverage', [diff]);
    expect(out).toContain('coverage baseline check failed: 1 violation');
    expect(out).toContain('apps/api/src/a.ts');
    expect(out).toContain('lines: 90 → 87');
    expect(out).toContain('absolute-pp(pp=2)');
    expect(out).toContain('(fail)');
  });

  it('renders a multi-violation block with summary counts split fail/warn', () => {
    const tol: ToleranceSpec = { kind: 'hard-cap', cap: 1_048_576, warnPct: 0.9 };
    const diffs: Diff[] = [
      {
        identifier: 'apps/api worker',
        axis: 'rawKb',
        prev: 0,
        next: 1_048_576,
        tolerance: tol,
        severity: 'fail',
      },
      {
        identifier: 'apps/web islands',
        axis: 'gzippedKb',
        prev: 0,
        next: 0.95 * 1_048_576,
        tolerance: tol,
        severity: 'warn',
      },
    ];
    const out = formatRejectionMessage('bundle-size', diffs);
    expect(out).toContain('1 fail · 1 warn');
    expect(out).toContain('(fail)');
    expect(out).toContain('(warn)');
    expect(out).toContain('hard-cap(cap=1048576, warnPct=0.9)');
  });

  it('renders relative-pct tolerance params', () => {
    const tol: ToleranceSpec = { kind: 'relative-pct', pct: 5 };
    const diff: Diff = {
      identifier: 'apps/api/src/m.ts',
      axis: 'score',
      prev: 80,
      next: 75,
      tolerance: tol,
      severity: 'fail',
    };
    const out = formatRejectionMessage('mutation', [diff]);
    expect(out).toContain('relative-pct(pct=5)');
  });

  it('renders route-band tolerance params', () => {
    const tol: ToleranceSpec = { kind: 'route-band', plusMinus: 3 };
    const diff: Diff = {
      identifier: '/',
      axis: 'performance',
      prev: 90,
      next: 86,
      tolerance: tol,
      severity: 'fail',
    };
    const out = formatRejectionMessage('lighthouse', [diff]);
    expect(out).toContain('route-band(plusMinus=3)');
  });

  it('renders absolute-int tolerance params', () => {
    const tol: ToleranceSpec = { kind: 'absolute-int', delta: 0 };
    const diff: Diff = {
      identifier: 'apps/api/src/a.ts',
      axis: 'warningCount',
      prev: 3,
      next: 5,
      tolerance: tol,
      severity: 'fail',
    };
    const out = formatRejectionMessage('lint', [diff]);
    expect(out).toContain('absolute-int(delta=0)');
  });
});
