// scripts/__tests__/crap-baseline.test.mjs
//
// AC-pinning tests for the CRAP baseline ratchet (Task #214).
//
// These tests run under the repo's Vitest `scripts` project so
// `pnpm run test` exercises them on every PR. They pin the script's
// scoring kernel, rollup math, envelope canonicalisation, and the
// relative-5% tolerance contract from ADR-018.
//
// Three acceptance criteria are pinned here:
//   1. Row sort order — successive `:update` runs against an
//      unchanged tree are byte-identical (rows sorted by path then
//      startLine then method).
//   2. A synthetic +20% CRAP increase on one function produces a
//      non-zero `:check` exit naming the file, method, and prev/next
//      CRAP scores.
//   3. The shipped baselines/crap.json carries the envelope shape
//      (empty rows + zero rollup) so `--check` on a fresh clone is a
//      pass.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KERNEL_VERSION,
  SCHEMA_POINTER,
  TOLERANCE_PCT,
  buildEnvelope,
  compareCrap,
  crapFormula,
  discoverSources,
  formatCrapRejection,
  parseArgs,
  rollupRows,
  scoreSource,
} from '../crap-baseline.mjs';

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to check mode', () => {
    expect(parseArgs(['node', 'script.mjs']).mode).toBe('check');
  });

  it('parses --check', () => {
    expect(parseArgs(['node', 'script.mjs', '--check']).mode).toBe('check');
  });

  it('parses --update', () => {
    expect(parseArgs(['node', 'script.mjs', '--update']).mode).toBe('update');
  });

  it('parses --help', () => {
    expect(parseArgs(['node', 'script.mjs', '--help']).mode).toBe('help');
  });

  it('parses --scan-root=<dir>', () => {
    const { scanRoot } = parseArgs(['node', 'script.mjs', '--scan-root=/tmp/src']);
    expect(scanRoot).toBe('/tmp/src');
  });
});

// ---------------------------------------------------------------------------
// crapFormula
// ---------------------------------------------------------------------------

describe('crapFormula', () => {
  it('returns c² + c when coverage is 0', () => {
    expect(crapFormula(3, 0)).toBe(12); // 9 + 3
    expect(crapFormula(5, 0)).toBe(30); // 25 + 5
  });

  it('returns c when coverage is 1 (fully covered)', () => {
    expect(crapFormula(5, 1)).toBe(5);
  });

  it('clamps coverage to [0, 1]', () => {
    expect(crapFormula(3, -5)).toBe(12);
    expect(crapFormula(3, 10)).toBe(3);
  });

  it('returns 0 for a method with no branches and full coverage', () => {
    expect(crapFormula(0, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreSource — kernel behaviour against real source
// ---------------------------------------------------------------------------

describe('scoreSource', () => {
  it('scores a simple multi-branch JS function', () => {
    const src = `function foo(x) {
  if (x > 0) { return x * 2; }
  else if (x < 0) { return -x; }
  else { return 0; }
}`;
    const rows = scoreSource(src);
    expect(rows).toHaveLength(1);
    expect(rows[0].method).toBe('foo');
    expect(rows[0].startLine).toBe(1);
    // cyclomatic = 3 (if, else-if, else), crap = 9 + 3 = 12 at cov=0
    expect(rows[0].crap).toBe(12);
  });

  it('returns an empty array on parse error', () => {
    expect(scoreSource('this is not (valid) source {{{ }')).toEqual([]);
  });

  it('names anonymous methods explicitly', () => {
    const src = `const f = function () { return 1; };`;
    const rows = scoreSource(src);
    expect(rows).toHaveLength(1);
    expect(typeof rows[0].method).toBe('string');
    expect(rows[0].method.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// rollupRows
// ---------------------------------------------------------------------------

describe('rollupRows', () => {
  it('returns zeros for an empty list', () => {
    expect(rollupRows([])).toEqual({ p50: 0, p95: 0, max: 0, methodsAbove20: 0 });
  });

  it('reports max as the highest crap score', () => {
    const rows = [
      { path: 'a.ts', method: 'a', startLine: 1, crap: 1 },
      { path: 'a.ts', method: 'b', startLine: 5, crap: 25 },
      { path: 'a.ts', method: 'c', startLine: 9, crap: 3 },
    ];
    expect(rollupRows(rows).max).toBe(25);
  });

  it('counts methods above the 20 ceiling', () => {
    const rows = [
      { path: 'a.ts', method: 'a', startLine: 1, crap: 5 },
      { path: 'a.ts', method: 'b', startLine: 5, crap: 25 },
      { path: 'a.ts', method: 'c', startLine: 9, crap: 30 },
      { path: 'a.ts', method: 'd', startLine: 13, crap: 21 },
    ];
    expect(rollupRows(rows).methodsAbove20).toBe(3);
  });

  it('honours the 20 boundary strictly (> 20, not >=)', () => {
    const rows = [{ path: 'a.ts', method: 'a', startLine: 1, crap: 20 }];
    expect(rollupRows(rows).methodsAbove20).toBe(0);
  });

  it('computes p50 / p95 via nearest-rank', () => {
    // 10 scores: 1, 2, 3, ..., 10. p50 → rank 5 (value 5); p95 → rank 10 (value 10).
    const rows = Array.from({ length: 10 }, (_, i) => ({
      path: 'a.ts',
      method: `m${i}`,
      startLine: i + 1,
      crap: i + 1,
    }));
    const r = rollupRows(rows);
    expect(r.p50).toBe(5);
    expect(r.p95).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// buildEnvelope — shape and canonical row ordering (AC #1)
// ---------------------------------------------------------------------------

describe('buildEnvelope', () => {
  function fixedDate() {
    return new Date('2026-05-17T00:00:00.000Z');
  }

  it('emits the $schema, kernelVersion, generatedAt, rollup, rows envelope', () => {
    const env = buildEnvelope(
      { rows: [{ path: 'a.ts', method: 'foo', startLine: 1, crap: 5 }] },
      fixedDate(),
    );
    expect(env.$schema).toBe(SCHEMA_POINTER);
    expect(env.kernelVersion).toBe(KERNEL_VERSION);
    expect(env.generatedAt).toBe('2026-05-17T00:00:00.000Z');
    expect(env.rollup['*']).toEqual({ p50: 5, p95: 5, max: 5, methodsAbove20: 0 });
    expect(env.rows).toHaveLength(1);
  });

  it('sorts rows canonically by path, then startLine, then method', () => {
    const env = buildEnvelope(
      {
        rows: [
          { path: 'z.ts', method: 'b', startLine: 1, crap: 1 },
          { path: 'a.ts', method: 'a', startLine: 10, crap: 1 },
          { path: 'a.ts', method: 'a', startLine: 5, crap: 1 },
          { path: 'a.ts', method: 'b', startLine: 5, crap: 1 },
        ],
      },
      fixedDate(),
    );
    expect(env.rows.map((r) => `${r.path}:${r.startLine}:${r.method}`)).toEqual([
      'a.ts:5:a',
      'a.ts:5:b',
      'a.ts:10:a',
      'z.ts:1:b',
    ]);
  });

  it('is idempotent — re-building from the same rows yields equal output', () => {
    const rows = [
      { path: 'b.ts', method: 'foo', startLine: 1, crap: 12 },
      { path: 'a.ts', method: 'bar', startLine: 7, crap: 3 },
    ];
    const a = buildEnvelope({ rows }, fixedDate());
    const b = buildEnvelope({ rows: [...rows].reverse() }, fixedDate());
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// compareCrap — ADR-018 relative-5% per-method ratchet (AC #2)
// ---------------------------------------------------------------------------

describe('compareCrap', () => {
  function envelopeWith(rows) {
    return buildEnvelope({ rows }, new Date('2026-05-17T00:00:00.000Z'));
  }

  it('returns no violations when nothing changed', () => {
    const base = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 12 }]);
    const next = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 12 }]);
    expect(compareCrap(base, next)).toEqual([]);
  });

  it('allows a 4% rise (within tolerance)', () => {
    const base = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 100 }]);
    const next = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 104 }]);
    expect(compareCrap(base, next)).toEqual([]);
  });

  it('allows exactly a 5% rise (at the tolerance edge)', () => {
    const base = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 100 }]);
    const next = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 105 }]);
    expect(compareCrap(base, next)).toEqual([]);
  });

  it('flags a +20% CRAP rise on one function (the synthetic AC case)', () => {
    const base = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 10 }]);
    const next = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 12 }]);
    const diffs = compareCrap(base, next);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      identifier: 'a.ts:foo',
      axis: 'crap',
      prev: 10,
      next: 12,
      severity: 'fail',
    });
  });

  it('flags every regressed method independently', () => {
    const base = envelopeWith([
      { path: 'a.ts', method: 'foo', startLine: 1, crap: 10 },
      { path: 'a.ts', method: 'bar', startLine: 5, crap: 5 },
      { path: 'b.ts', method: 'baz', startLine: 1, crap: 20 },
    ]);
    const next = envelopeWith([
      { path: 'a.ts', method: 'foo', startLine: 1, crap: 12 }, // +20% — fail
      { path: 'a.ts', method: 'bar', startLine: 5, crap: 5 }, // unchanged
      { path: 'b.ts', method: 'baz', startLine: 1, crap: 25 }, // +25% — fail
    ]);
    const ids = compareCrap(base, next)
      .map((d) => d.identifier)
      .sort();
    expect(ids).toEqual(['a.ts:foo', 'b.ts:baz']);
  });

  it('ignores deletions — removing a regression is never a regression', () => {
    const base = envelopeWith([
      { path: 'a.ts', method: 'foo', startLine: 1, crap: 100 },
      { path: 'a.ts', method: 'bar', startLine: 5, crap: 50 },
    ]);
    const next = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 100 }]);
    expect(compareCrap(base, next)).toEqual([]);
  });

  it('flags new rows with positive CRAP as regressions (prev=0, lower-is-better)', () => {
    const base = envelopeWith([]);
    const next = envelopeWith([{ path: 'a.ts', method: 'newFn', startLine: 1, crap: 5 }]);
    const diffs = compareCrap(base, next);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].identifier).toBe('a.ts:newFn');
  });

  it('line-shift-only produces zero violations (AC: pure line shift is not a regression)', () => {
    // foo moved from line 1 to line 10 — same name, same file, same CRAP score.
    const base = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 12 }]);
    const next = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 10, crap: 12 }]);
    expect(compareCrap(base, next)).toEqual([]);
  });

  it('real complexity increase on a moved function is still flagged (AC: genuine regression survives line-shift fix)', () => {
    // foo moved from line 1 to line 10 AND its CRAP rose by +20%.
    const base = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 1, crap: 10 }]);
    const next = envelopeWith([{ path: 'a.ts', method: 'foo', startLine: 10, crap: 12 }]);
    const diffs = compareCrap(base, next);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ identifier: 'a.ts:foo', severity: 'fail' });
  });

  it('brand-new high-CRAP function is flagged even after line-shift fix (AC: new function still surfaces)', () => {
    const base = envelopeWith([{ path: 'a.ts', method: 'existingFn', startLine: 1, crap: 2 }]);
    const next = envelopeWith([
      { path: 'a.ts', method: 'existingFn', startLine: 1, crap: 2 },
      { path: 'a.ts', method: 'newHighCrap', startLine: 50, crap: 30 },
    ]);
    const diffs = compareCrap(base, next);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].identifier).toBe('a.ts:newHighCrap');
  });

  it('honours TOLERANCE_PCT from the script', () => {
    // The exported constant pins the ADR-018 5% policy. If someone
    // edits it, every consuming test breaks until docs and ADR move
    // together.
    expect(TOLERANCE_PCT).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// formatCrapRejection
// ---------------------------------------------------------------------------

describe('formatCrapRejection', () => {
  it('names the file, the method, and the prev/next CRAP scores', () => {
    const base = buildEnvelope(
      { rows: [{ path: 'a.ts', method: 'foo', startLine: 1, crap: 10 }] },
      new Date('2026-05-17T00:00:00.000Z'),
    );
    const next = buildEnvelope(
      { rows: [{ path: 'a.ts', method: 'foo', startLine: 1, crap: 12 }] },
      new Date('2026-05-17T00:00:00.000Z'),
    );
    const msg = formatCrapRejection(compareCrap(base, next));
    expect(msg).toMatch(/a\.ts/);
    expect(msg).toMatch(/foo/);
    expect(msg).toMatch(/10/);
    expect(msg).toMatch(/12/);
    expect(msg).toMatch(/crap/);
  });

  it('returns an empty string for an empty diff array', () => {
    expect(formatCrapRejection([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// discoverSources — apps/* and packages/* walk
// ---------------------------------------------------------------------------

describe('discoverSources', () => {
  it('returns a sorted, repo-relative POSIX path list', () => {
    const found = discoverSources();
    // The walk is repo-wide; even if some workspace folders are empty
    // today, the function should not throw and should return an array.
    expect(Array.isArray(found)).toBe(true);
    const sorted = [...found].sort();
    expect(found).toEqual(sorted);
    // No path should contain a backslash on Windows — POSIX-only.
    for (const p of found) {
      expect(p).not.toMatch(/\\/);
    }
  });
});

// ---------------------------------------------------------------------------
// Shipped baselines/crap.json — envelope shape (AC #3)
// ---------------------------------------------------------------------------

describe('shipped baselines/crap.json', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const baselinePath = path.join(repoRoot, 'baselines', 'crap.json');

  it('exists and parses as JSON', () => {
    const raw = fs.readFileSync(baselinePath, 'utf8');
    const doc = JSON.parse(raw);
    expect(doc.$schema).toBe(SCHEMA_POINTER);
    expect(doc.kernelVersion).toBe(KERNEL_VERSION);
  });

  it('carries the envelope shape (rollup."*" with four required axes)', () => {
    const doc = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    expect(doc.rollup).toBeDefined();
    expect(doc.rollup['*']).toBeDefined();
    for (const axis of ['p50', 'p95', 'max', 'methodsAbove20']) {
      expect(doc.rollup['*']).toHaveProperty(axis);
      expect(typeof doc.rollup['*'][axis]).toBe('number');
    }
    expect(Array.isArray(doc.rows)).toBe(true);
  });
});
