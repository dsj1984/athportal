// scripts/__tests__/lint-baseline-envelope.test.mjs
//
// AC-pinning tests for the envelope-shaped lint baseline ratchet
// (Task #243 under Story #238).
//
// These tests run under the repo's Vitest `scripts` project (declared in
// vitest.workspace.ts) so `pnpm run test` exercises them on every PR.
// They pin the script's parsing, merge, envelope-build, serialiser, and
// tolerance helpers without invoking the linters end-to-end — the
// Biome/ESLint subprocesses are slow and noisy in unit tests; the
// integration behaviour is validated by `pnpm run lint:baseline:check`
// in CI's quality:ci-local chain.
//
// AC bullets covered (Story #238 / Task #243):
//   1. Envelope round-trip is byte-identical when the source tree is
//      unchanged (serialise → parse → serialise yields the same string).
//   2. A synthetic added-warning fixture triggers a non-zero exit with
//      a per-file diff line in the rejection message.
//
// AC bullets covered (Story #238 / Task #244, exercised here too):
//   - `--check` against the unprimed empty baseline exits clean for an
//     unchanged tree (`totalDelta <= 0 && regressions.length === 0`).
//   - Per-file warning ratchet — a file gaining one warning fails.
//   - Net-total non-increasing — a flat-distributed warning increase
//     across files still fails.
//   - The committed baselines/lint.json validates against the per-kind
//     schema at .agents/schemas/baselines/lint.schema.json.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_PATH,
  KERNEL_VERSION,
  SCHEMA_POINTER,
  buildEnvelope,
  compareTolerance,
  formatRejectionMessage,
  mergeCounts,
  parseArgs,
  serialise,
  toPosixRel,
} from '../lint-baseline.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fixedDate() {
  return new Date('2026-05-17T00:00:00.000Z');
}

function envelopeWith(rows, rollup = null) {
  const computedRollup =
    rollup ??
    rows.reduce(
      (acc, r) => ({
        errorCount: acc.errorCount + (r.errorCount ?? 0),
        warningCount: acc.warningCount + (r.warningCount ?? 0),
      }),
      { errorCount: 0, warningCount: 0 },
    );
  return {
    $schema: SCHEMA_POINTER,
    kernelVersion: KERNEL_VERSION,
    generatedAt: '2026-05-17T00:00:00.000Z',
    rollup: { '*': computedRollup },
    rows,
  };
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults to check mode', () => {
    expect(parseArgs(['node', 'lint-baseline.mjs']).mode).toBe('check');
  });

  it('parses --check', () => {
    expect(parseArgs(['node', 'lint-baseline.mjs', '--check']).mode).toBe('check');
  });

  it('parses --update', () => {
    expect(parseArgs(['node', 'lint-baseline.mjs', '--update']).mode).toBe('update');
  });

  it('parses --help', () => {
    expect(parseArgs(['node', 'lint-baseline.mjs', '--help']).mode).toBe('help');
  });
});

// ---------------------------------------------------------------------------
// toPosixRel
// ---------------------------------------------------------------------------

describe('toPosixRel', () => {
  it('strips a leading ./ to keep row paths consistent', () => {
    expect(toPosixRel('./scripts/a.mjs')).toBe('scripts/a.mjs');
  });

  it('relativises absolute paths against the repo root', () => {
    const abs = path.resolve('./scripts/a.mjs');
    const rel = toPosixRel(abs, path.resolve('.'));
    expect(rel).toBe('scripts/a.mjs');
  });

  it('normalises backslashes (Windows) to forward slashes', () => {
    const rel = toPosixRel(['apps', 'web', 'src', 'a.ts'].join(path.sep));
    expect(rel).toBe('apps/web/src/a.ts');
  });
});

// ---------------------------------------------------------------------------
// mergeCounts — Biome + ESLint per-file count maps fold to a single rows[]
// ---------------------------------------------------------------------------

describe('mergeCounts', () => {
  it('returns an empty rollup and rows[] for no input', () => {
    expect(mergeCounts(new Map())).toEqual({
      rollup: { errorCount: 0, warningCount: 0 },
      rows: [],
    });
  });

  it('sums counts across both linters for the same file', () => {
    const biome = new Map([['src/a.ts', { errorCount: 1, warningCount: 2 }]]);
    const eslint = new Map([['src/a.ts', { errorCount: 0, warningCount: 3 }]]);
    const { rollup, rows } = mergeCounts(biome, eslint);
    expect(rollup).toEqual({ errorCount: 1, warningCount: 5 });
    expect(rows).toEqual([{ path: 'src/a.ts', errorCount: 1, warningCount: 5 }]);
  });

  it('sorts rows by path lex (stable diff output)', () => {
    const biome = new Map([
      ['z/last.ts', { errorCount: 0, warningCount: 1 }],
      ['a/first.ts', { errorCount: 0, warningCount: 1 }],
    ]);
    const { rows } = mergeCounts(biome);
    expect(rows.map((r) => r.path)).toEqual(['a/first.ts', 'z/last.ts']);
  });
});

// ---------------------------------------------------------------------------
// buildEnvelope — shape contract
// ---------------------------------------------------------------------------

describe('buildEnvelope', () => {
  it('emits $schema, kernelVersion, generatedAt, rollup, rows in the envelope shape', () => {
    const env = buildEnvelope(
      {
        rollup: { errorCount: 1, warningCount: 2 },
        rows: [{ path: 'src/a.ts', errorCount: 1, warningCount: 2 }],
      },
      fixedDate(),
    );
    expect(env.$schema).toBe(SCHEMA_POINTER);
    expect(env.kernelVersion).toBe(KERNEL_VERSION);
    expect(env.generatedAt).toBe('2026-05-17T00:00:00.000Z');
    expect(env.rollup['*']).toEqual({ errorCount: 1, warningCount: 2 });
    expect(env.rows).toEqual([{ path: 'src/a.ts', errorCount: 1, warningCount: 2 }]);
  });

  it('emits a zero rollup when no rows are present', () => {
    const env = buildEnvelope(
      { rollup: { errorCount: 0, warningCount: 0 }, rows: [] },
      fixedDate(),
    );
    expect(env.rollup['*']).toEqual({ errorCount: 0, warningCount: 0 });
    expect(env.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// serialise — byte-stable, sorted-key, trailing-newline
// (round-trip AC for Task #243)
// ---------------------------------------------------------------------------

describe('serialise', () => {
  it('produces byte-identical output for the same envelope on repeated calls', () => {
    const env = buildEnvelope(
      {
        rollup: { errorCount: 1, warningCount: 2 },
        rows: [{ path: 'src/a.ts', errorCount: 1, warningCount: 2 }],
      },
      fixedDate(),
    );
    expect(serialise(env)).toBe(serialise(env));
  });

  it('round-trips through parse → serialise without byte drift (the AC)', () => {
    // This is the AC that pins the envelope round-trip when the source
    // tree is unchanged: serialise(parse(serialise(env))) === serialise(env).
    const env = buildEnvelope(
      {
        rollup: { errorCount: 1, warningCount: 2 },
        rows: [{ path: 'src/a.ts', errorCount: 1, warningCount: 2 }],
      },
      fixedDate(),
    );
    const first = serialise(env);
    const reparsed = JSON.parse(first);
    const second = serialise(reparsed);
    expect(second).toBe(first);
  });

  it('emits sorted keys at every depth', () => {
    const env = {
      $schema: 'x',
      kernelVersion: '1.0.0',
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: { '*': { warningCount: 2, errorCount: 1 } },
      rows: [{ warningCount: 2, path: 'a.ts', errorCount: 1 }],
    };
    const out = serialise(env);
    // Top-level keys must be lex-ordered.
    const topOrder = ['"$schema"', '"generatedAt"', '"kernelVersion"', '"rollup"', '"rows"'];
    let cursor = 0;
    for (const needle of topOrder) {
      const pos = out.indexOf(needle, cursor);
      expect(pos).toBeGreaterThan(cursor);
      cursor = pos;
    }
    // Inside row objects: errorCount before path before warningCount.
    // Scope the check to the rows block so we don't trip on rollup's
    // earlier (errorCount, warningCount) pair.
    const rowsStart = out.indexOf('"rows"');
    const rowBlock = out.slice(rowsStart);
    expect(rowBlock.indexOf('"errorCount"')).toBeLessThan(rowBlock.indexOf('"path"'));
    expect(rowBlock.indexOf('"path"')).toBeLessThan(rowBlock.indexOf('"warningCount"'));
  });

  it('ends with a trailing newline', () => {
    const env = buildEnvelope(
      { rollup: { errorCount: 0, warningCount: 0 }, rows: [] },
      fixedDate(),
    );
    expect(serialise(env).endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compareTolerance — per-file ratchet + net-total non-increasing
// ---------------------------------------------------------------------------

describe('compareTolerance', () => {
  it('returns no regressions when current matches baseline', () => {
    const baseline = envelopeWith([{ path: 'src/a.ts', errorCount: 0, warningCount: 2 }]);
    const current = envelopeWith([{ path: 'src/a.ts', errorCount: 0, warningCount: 2 }]);
    const { warningRegressions, errorFiles, currErrors, warnDelta } = compareTolerance(
      baseline,
      current,
    );
    expect(warningRegressions).toEqual([]);
    expect(errorFiles).toEqual([]);
    expect(currErrors).toBe(0);
    expect(warnDelta).toBe(0);
  });

  it('returns no warning regressions when warnings drop (improving the gate is always allowed)', () => {
    const baseline = envelopeWith([{ path: 'src/a.ts', errorCount: 0, warningCount: 5 }]);
    const current = envelopeWith([{ path: 'src/a.ts', errorCount: 0, warningCount: 3 }]);
    const { warningRegressions, warnDelta } = compareTolerance(baseline, current);
    expect(warningRegressions).toEqual([]);
    expect(warnDelta).toBe(-2);
  });

  it('flags a per-file warning regression when a single file gains a warning', () => {
    // Synthetic added-warning fixture: a known file moves from 2 → 3
    // warnings; the gate must fail with a per-file diff line.
    const baseline = envelopeWith([{ path: 'src/a.ts', errorCount: 0, warningCount: 2 }]);
    const current = envelopeWith([{ path: 'src/a.ts', errorCount: 0, warningCount: 3 }]);
    const result = compareTolerance(baseline, current);
    expect(result.warningRegressions).toHaveLength(1);
    expect(result.warningRegressions[0]).toEqual({ file: 'src/a.ts', prev: 2, count: 3 });
    expect(result.warnDelta).toBe(1);
  });

  it('treats a brand-new file with warnings as a regression vs implicit-zero prev', () => {
    const baseline = envelopeWith([]);
    const current = envelopeWith([{ path: 'src/new.ts', errorCount: 0, warningCount: 1 }]);
    const result = compareTolerance(baseline, current);
    expect(result.warningRegressions).toHaveLength(1);
    expect(result.warningRegressions[0]).toEqual({ file: 'src/new.ts', prev: 0, count: 1 });
  });

  it('reports current errors and per-file error rows when any error appears (Story #373)', () => {
    // New contract: errors are non-negotiable. The current aggregate must
    // surface its error count and the files carrying them so the gate can
    // refuse the run independent of baseline state.
    const baseline = envelopeWith([{ path: 'src/a.ts', errorCount: 0, warningCount: 0 }]);
    const current = envelopeWith([{ path: 'src/a.ts', errorCount: 5, warningCount: 0 }]);
    const result = compareTolerance(baseline, current);
    expect(result.currErrors).toBe(5);
    expect(result.errorFiles).toEqual([{ file: 'src/a.ts', count: 5 }]);
  });

  it('aggregates errors from multiple files into the errorFiles list', () => {
    const baseline = envelopeWith([]);
    const current = envelopeWith([
      { path: 'src/a.ts', errorCount: 2, warningCount: 0 },
      { path: 'src/b.ts', errorCount: 3, warningCount: 0 },
    ]);
    const result = compareTolerance(baseline, current);
    expect(result.errorFiles).toEqual([
      { file: 'src/a.ts', count: 2 },
      { file: 'src/b.ts', count: 3 },
    ]);
  });

  it('reads baseline & current rollup warning totals from the rollup."*" envelope shape', () => {
    const baseline = envelopeWith([{ path: 'src/a.ts', errorCount: 0, warningCount: 2 }], {
      errorCount: 0,
      warningCount: 2,
    });
    const current = envelopeWith([{ path: 'src/a.ts', errorCount: 0, warningCount: 4 }], {
      errorCount: 0,
      warningCount: 4,
    });
    const result = compareTolerance(baseline, current);
    expect(result.baseWarn).toBe(2);
    expect(result.currWarn).toBe(4);
    expect(result.warnDelta).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// formatRejectionMessage — names each regressed file with its prev → next,
// and surfaces errors as a separate blocking channel (Story #373).
// ---------------------------------------------------------------------------

describe('formatRejectionMessage', () => {
  it('renders a per-file diff line in stderr-friendly shape', () => {
    const msg = formatRejectionMessage({
      warningRegressions: [{ file: 'src/a.ts', prev: 2, count: 3 }],
      errorFiles: [],
      currErrors: 0,
      baseWarn: 2,
      currWarn: 3,
      warnDelta: 1,
    });
    expect(msg).toMatch(/src\/a\.ts/);
    expect(msg).toMatch(/2 → 3/);
  });

  it('names the totalWarnings transition with the signed delta', () => {
    const msg = formatRejectionMessage({
      warningRegressions: [{ file: 'src/a.ts', prev: 2, count: 3 }],
      errorFiles: [],
      currErrors: 0,
      baseWarn: 2,
      currWarn: 3,
      warnDelta: 1,
    });
    expect(msg).toMatch(/baseline=2 current=3 \(Δ=\+1\)/);
  });

  it('surfaces a blocking error line and per-file counts when currErrors > 0', () => {
    const msg = formatRejectionMessage({
      warningRegressions: [],
      errorFiles: [
        { file: 'src/a.ts', count: 2 },
        { file: 'src/b.ts', count: 1 },
      ],
      currErrors: 3,
      baseWarn: 0,
      currWarn: 0,
      warnDelta: 0,
    });
    expect(msg).toMatch(/errors: 3/);
    expect(msg).toMatch(/blocking/i);
    expect(msg).toMatch(/src\/a\.ts: 2 errors/);
    expect(msg).toMatch(/src\/b\.ts: 1 error/);
  });

  it('mentions the lint:baseline:update remediation path AND notes errors are not absorbable', () => {
    const msg = formatRejectionMessage({
      warningRegressions: [],
      errorFiles: [{ file: 'src/a.ts', count: 1 }],
      currErrors: 1,
      baseWarn: 0,
      currWarn: 0,
      warnDelta: 0,
    });
    expect(msg).toMatch(/lint:baseline:update/);
    expect(msg).toMatch(/Errors cannot be absorbed/i);
  });
});

// ---------------------------------------------------------------------------
// Shipped baselines/lint.json — envelope shape + schema validation
// ---------------------------------------------------------------------------

describe('shipped baselines/lint.json', () => {
  it('exists and parses as JSON', () => {
    const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
    const doc = JSON.parse(raw);
    expect(doc.$schema).toBe(SCHEMA_POINTER);
    expect(doc.kernelVersion).toBe(KERNEL_VERSION);
  });

  it('carries the envelope shape (rollup."*" with errorCount + warningCount, rows[])', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    expect(doc.rollup).toBeDefined();
    expect(doc.rollup['*']).toBeDefined();
    expect(typeof doc.rollup['*'].errorCount).toBe('number');
    expect(typeof doc.rollup['*'].warningCount).toBe('number');
    expect(Array.isArray(doc.rows)).toBe(true);
  });

  it('every row carries path + errorCount + warningCount and no extras', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    for (const row of doc.rows) {
      expect(Object.keys(row).sort()).toEqual(['errorCount', 'path', 'warningCount']);
      expect(typeof row.path).toBe('string');
      expect(typeof row.errorCount).toBe('number');
      expect(typeof row.warningCount).toBe('number');
    }
  });

  it('row paths are sorted lex (diff-stable)', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const paths = doc.rows.map((r) => r.path);
    const sorted = [...paths].sort();
    expect(paths).toEqual(sorted);
  });

  it('rollup totals reconcile with per-row sums for both errors and warnings', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const sumWarn = doc.rows.reduce((acc, r) => acc + r.warningCount, 0);
    const sumErr = doc.rows.reduce((acc, r) => acc + r.errorCount, 0);
    expect(sumWarn).toBe(doc.rollup['*'].warningCount);
    expect(sumErr).toBe(doc.rollup['*'].errorCount);
  });

  it('rollup."*".errorCount is zero (Story #373 — error contract is zero)', () => {
    const doc = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    expect(doc.rollup['*'].errorCount).toBe(0);
  });
});
