// scripts/__tests__/maintainability-baseline.test.mjs
//
// AC-pinning tests for the maintainability baseline ratchet (Task #218).
//
// These tests run under the repo's Vitest `scripts` project so
// `pnpm run test` exercises them on every PR. They pin the script's
// scoring kernel, rollup math, envelope canonicalisation, component
// resolution, and the framework-default `rollup['*'].min >= 70` floor
// contract from ADR-019.
//
// Acceptance criteria pinned here (Task #218):
//   1. Rollup `*` min >= 70 is enforced on :check; failure log names
//      the worst-MI file dragging the min below the floor.
//   2. Per-component rollup keys auto-populate for each apps/* and
//      packages/* workspace discovered on disk.
//   3. Row sort order — successive `:update` runs against an
//      unchanged tree are byte-identical (rows sorted by path).
//   4. The shipped baselines/maintainability.json carries the
//      envelope shape (empty rows + zero rollup) so `--check` on a
//      fresh clone is a pass.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KERNEL_VERSION,
  MI_MIN_FLOOR,
  SCHEMA_POINTER,
  buildEnvelope,
  compareFloor,
  componentForRow,
  discoverSources,
  formatFloorRejection,
  parseArgs,
  rollupAxes,
  rollupByComponent,
  scoreSource,
} from '../maintainability-baseline.mjs';

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
// scoreSource — escomplex kernel behaviour
// ---------------------------------------------------------------------------

describe('scoreSource', () => {
  it('returns a numeric MI for a small JS module', () => {
    const src = `function add(a, b) { return a + b; }`;
    const mi = scoreSource(src);
    expect(typeof mi).toBe('number');
    // Trivial modules score very high; pin the lower bound rather than
    // an exact value so escomplex micro-version drift doesn't flake.
    expect(mi).toBeGreaterThan(100);
  });

  it('scores TypeScript sources via the typescript flag', () => {
    const src = `export const add = (a: number, b: number): number => a + b;`;
    const mi = scoreSource(src);
    expect(typeof mi).toBe('number');
    expect(mi).toBeGreaterThan(100);
  });

  it('returns null on parse error (unscorable, not zero)', () => {
    expect(scoreSource('this is not (valid) source {{{ }')).toBeNull();
  });

  it('scores a highly-branched module lower than a trivial one', () => {
    const trivial = scoreSource(`function ok() { return 1; }`);
    const branchy = scoreSource(`function gnarly(x) {
      if (x > 0) { if (x > 10) { if (x > 100) { return 1; } else { return 2; } } else { return 3; } }
      else if (x < 0) { if (x < -10) { return 4; } else { return 5; } }
      else { return 6; }
      return 7;
    }`);
    expect(branchy).toBeLessThan(trivial);
  });
});

// ---------------------------------------------------------------------------
// componentForRow — workspace-based component resolution
// ---------------------------------------------------------------------------

describe('componentForRow', () => {
  it('maps an apps/* row to its workspace component', () => {
    expect(componentForRow('apps/web/src/index.ts')).toBe('apps/web');
    expect(componentForRow('apps/api/src/lib/x.ts')).toBe('apps/api');
  });

  it('maps a packages/* row to its workspace component', () => {
    expect(componentForRow('packages/shared/src/util.ts')).toBe('packages/shared');
    expect(componentForRow('packages/baselines/src/index.ts')).toBe('packages/baselines');
  });

  it('returns null for rows outside apps/* or packages/*', () => {
    expect(componentForRow('scripts/foo.mjs')).toBeNull();
    expect(componentForRow('docs/x.md')).toBeNull();
  });

  it('returns null for a single-segment path', () => {
    expect(componentForRow('README.md')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rollupAxes — min / p50 / p95 over a numeric list
// ---------------------------------------------------------------------------

describe('rollupAxes', () => {
  it('returns zero placeholders for an empty list', () => {
    expect(rollupAxes([])).toEqual({ min: 0, p50: 0, p95: 0 });
  });

  it('reports min as the smallest value', () => {
    expect(rollupAxes([85, 70, 92, 65]).min).toBe(65);
  });

  it('computes p50 / p95 via nearest-rank', () => {
    // 10 values 1..10; p50 → rank 5 (value 5); p95 → rank 10 (value 10).
    const values = Array.from({ length: 10 }, (_, i) => i + 1);
    const r = rollupAxes(values);
    expect(r.p50).toBe(5);
    expect(r.p95).toBe(10);
  });

  it('p50 / p95 on a single-element list collapse to that element', () => {
    expect(rollupAxes([72])).toEqual({ min: 72, p50: 72, p95: 72 });
  });
});

// ---------------------------------------------------------------------------
// rollupByComponent — per-workspace rollup auto-population (AC #2)
// ---------------------------------------------------------------------------

describe('rollupByComponent', () => {
  it("always populates the whole-repo '*' rollup, even with no rows", () => {
    const rollup = rollupByComponent([]);
    expect(rollup['*']).toEqual({ min: 0, p50: 0, p95: 0 });
  });

  it('auto-populates a key per apps/* workspace discovered in the rows', () => {
    const rows = [
      { path: 'apps/web/src/a.ts', mi: 85 },
      { path: 'apps/web/src/b.ts', mi: 90 },
      { path: 'apps/api/src/c.ts', mi: 78 },
    ];
    const rollup = rollupByComponent(rows);
    expect(rollup).toHaveProperty('apps/web');
    expect(rollup).toHaveProperty('apps/api');
    // nearest-rank on [85, 90]: p50 → ceil(0.5*2)=1, idx=0 → 85;
    //                            p95 → ceil(0.95*2)=2, idx=1 → 90.
    expect(rollup['apps/web']).toEqual({ min: 85, p50: 85, p95: 90 });
    expect(rollup['apps/api']).toEqual({ min: 78, p50: 78, p95: 78 });
  });

  it('auto-populates a key per packages/* workspace discovered in the rows', () => {
    const rows = [
      { path: 'packages/shared/src/a.ts', mi: 100 },
      { path: 'packages/baselines/src/b.ts', mi: 95 },
    ];
    const rollup = rollupByComponent(rows);
    expect(rollup).toHaveProperty('packages/shared');
    expect(rollup).toHaveProperty('packages/baselines');
  });

  it("'*' includes every row regardless of component membership", () => {
    const rows = [
      { path: 'apps/web/src/a.ts', mi: 80 },
      { path: 'packages/shared/src/b.ts', mi: 90 },
      { path: 'scripts/c.mjs', mi: 70 }, // outside apps/* and packages/*
    ];
    const rollup = rollupByComponent(rows);
    expect(rollup['*'].min).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// buildEnvelope — shape and canonical row ordering (AC #3)
// ---------------------------------------------------------------------------

describe('buildEnvelope', () => {
  function fixedDate() {
    return new Date('2026-05-17T00:00:00.000Z');
  }

  it('emits the $schema, kernelVersion, generatedAt, rollup, rows envelope', () => {
    const env = buildEnvelope({ rows: [{ path: 'apps/web/src/a.ts', mi: 85 }] }, fixedDate());
    expect(env.$schema).toBe(SCHEMA_POINTER);
    expect(env.kernelVersion).toBe(KERNEL_VERSION);
    expect(env.generatedAt).toBe('2026-05-17T00:00:00.000Z');
    expect(env.rollup['*']).toEqual({ min: 85, p50: 85, p95: 85 });
    expect(env.rollup['apps/web']).toEqual({ min: 85, p50: 85, p95: 85 });
    expect(env.rows).toHaveLength(1);
  });

  it('sorts rows by path lexicographically', () => {
    const env = buildEnvelope(
      {
        rows: [
          { path: 'z.ts', mi: 80 },
          { path: 'a.ts', mi: 70 },
          { path: 'm.ts', mi: 75 },
        ],
      },
      fixedDate(),
    );
    expect(env.rows.map((r) => r.path)).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });

  it('is idempotent — re-building from the same rows yields equal output', () => {
    const rows = [
      { path: 'b.ts', mi: 80 },
      { path: 'a.ts', mi: 90 },
    ];
    const a = buildEnvelope({ rows }, fixedDate());
    const b = buildEnvelope({ rows: [...rows].reverse() }, fixedDate());
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// compareFloor — ADR-019 rollup `*` min ≥ 70 (AC #1)
// ---------------------------------------------------------------------------

describe('compareFloor', () => {
  function envelopeWith(rows) {
    return buildEnvelope({ rows }, new Date('2026-05-17T00:00:00.000Z'));
  }

  it('passes when rollup min is at the floor', () => {
    const env = envelopeWith([
      { path: 'apps/web/src/a.ts', mi: 70 },
      { path: 'apps/web/src/b.ts', mi: 80 },
    ]);
    const result = compareFloor(env, 70);
    expect(result.violation).toBe(false);
  });

  it('passes when rollup min is above the floor', () => {
    const env = envelopeWith([{ path: 'apps/web/src/a.ts', mi: 90 }]);
    expect(compareFloor(env, 70).violation).toBe(false);
  });

  it('flags a violation when rollup min is below the floor', () => {
    const env = envelopeWith([
      { path: 'apps/web/src/a.ts', mi: 60 },
      { path: 'apps/web/src/b.ts', mi: 90 },
    ]);
    const result = compareFloor(env, 70);
    expect(result.violation).toBe(true);
    expect(result.floor).toBe(70);
    expect(result.current).toBe(60);
    expect(result.worst).toEqual({ path: 'apps/web/src/a.ts', mi: 60 });
  });

  it('names the worst file as the one dragging the whole-repo min down', () => {
    const env = envelopeWith([
      { path: 'apps/web/src/a.ts', mi: 80 },
      { path: 'apps/web/src/b.ts', mi: 65 }, // worst
      { path: 'packages/shared/src/c.ts', mi: 75 },
    ]);
    const result = compareFloor(env, 70);
    expect(result.violation).toBe(true);
    expect(result.worst?.path).toBe('apps/web/src/b.ts');
  });

  it('honours MI_MIN_FLOOR exported from the script', () => {
    // The exported constant pins the ADR-019 framework-default floor.
    // If someone edits it, every consuming test breaks until docs and
    // ADR move together.
    expect(MI_MIN_FLOOR).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// formatFloorRejection — operator-facing failure log
// ---------------------------------------------------------------------------

describe('formatFloorRejection', () => {
  it('names the floor, the current min, and the worst file', () => {
    const env = buildEnvelope(
      { rows: [{ path: 'apps/web/src/a.ts', mi: 55 }] },
      new Date('2026-05-17T00:00:00.000Z'),
    );
    const msg = formatFloorRejection(compareFloor(env, 70));
    expect(msg).toMatch(/apps\/web\/src\/a\.ts/);
    expect(msg).toMatch(/55/);
    expect(msg).toMatch(/70/);
    expect(msg).toMatch(/mi=/);
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
// Shipped baselines/maintainability.json — envelope shape (AC #4)
// ---------------------------------------------------------------------------

describe('shipped baselines/maintainability.json', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const baselinePath = path.join(repoRoot, 'baselines', 'maintainability.json');

  it('exists and parses as JSON', () => {
    const raw = fs.readFileSync(baselinePath, 'utf8');
    const doc = JSON.parse(raw);
    expect(doc.$schema).toBe(SCHEMA_POINTER);
    expect(doc.kernelVersion).toBe(KERNEL_VERSION);
  });

  it("carries the envelope shape (rollup.'*' with three required axes)", () => {
    const doc = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    expect(doc.rollup).toBeDefined();
    expect(doc.rollup['*']).toBeDefined();
    for (const axis of ['min', 'p50', 'p95']) {
      expect(doc.rollup['*']).toHaveProperty(axis);
      expect(typeof doc.rollup['*'][axis]).toBe('number');
    }
    expect(Array.isArray(doc.rows)).toBe(true);
  });
});
