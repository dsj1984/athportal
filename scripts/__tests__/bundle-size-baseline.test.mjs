// scripts/__tests__/bundle-size-baseline.test.mjs
//
// AC-pinning tests for the bundle-size baseline ratchet (Task #216).
//
// These tests run under the repo's Vitest `scripts` project so
// `pnpm run test` exercises them on every PR. They pin the script's
// argv parsing, measurement kernel, envelope canonicalisation, the
// ADR-014 1 MiB Worker compressed cap (warn at 90%, fail at 100%
// regardless of per-bundle budget), and the rationale-paired bump
// rejection contract.
//
// Acceptance criteria pinned here (Task #216):
//   1. Worker compressed bytes > 1 048 576 fails `:check` with the
//      rejection string "Worker 1 MiB cap exceeded" regardless of
//      per-bundle gzippedKb budget.
//   2. Compressed bytes >= 90% of the 1 MiB cap emits a warning
//      without failing.
//   3. A bump to a per-bundle gzippedKb budget without a paired
//      rationale / lastRevised update fails `:check`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KERNEL_VERSION,
  SCHEMA_POINTER,
  WORKER_BUNDLE_NAME,
  WORKER_CAP_BYTES,
  buildEnvelope,
  bytesToKb,
  collectMeasurements,
  compareBudgets,
  compareRationaleAgainstBaseline,
  evaluateWorkerCap,
  formatBudgetFailure,
  formatRationaleFailure,
  formatWorkerCapFailure,
  formatWorkerCapWarning,
  measureFile,
  modeCheck,
  modeUpdate,
  parseArgs,
  readSizeLimit,
  rollupRows,
  serialise,
} from '../bundle-size-baseline.mjs';

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

  it('parses --repo-root=<dir>', () => {
    const { repoRootOverride } = parseArgs(['node', 'script.mjs', '--repo-root=/tmp/repo']);
    expect(repoRootOverride).toBe('/tmp/repo');
  });
});

// ---------------------------------------------------------------------------
// bytesToKb
// ---------------------------------------------------------------------------

describe('bytesToKb', () => {
  it('converts bytes to binary kilobytes (1024 bytes per KiB)', () => {
    expect(bytesToKb(1024)).toBe(1);
    expect(bytesToKb(2048)).toBe(2);
    expect(bytesToKb(0)).toBe(0);
  });

  it('rounds to two decimal places', () => {
    expect(bytesToKb(1100)).toBe(1.07);
    expect(bytesToKb(1500)).toBe(1.46);
  });
});

// ---------------------------------------------------------------------------
// Disk-backed harness — measureFile / collectMeasurements
// ---------------------------------------------------------------------------

describe('measureFile / collectMeasurements', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-size-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns null when the bundle file does not exist', () => {
    expect(measureFile(path.join(tmpRoot, 'missing.js'))).toBeNull();
  });

  it('reports raw + gzipped bytes for an existing file', () => {
    const body = Buffer.from('x'.repeat(2048));
    const abs = path.join(tmpRoot, 'bundle.js');
    fs.writeFileSync(abs, body);
    const r = measureFile(abs);
    expect(r).not.toBeNull();
    expect(r.rawBytes).toBe(2048);
    // Highly compressible input — gzip output is a small fraction.
    expect(r.gzippedBytes).toBeGreaterThan(0);
    expect(r.gzippedBytes).toBeLessThan(2048);
    // The exact compressed size from zlib level 9 for "x"*2048
    // matches gzipSync of the same buffer; compare against the source
    // of truth instead of pinning a numeric constant that could drift
    // across Node minor versions.
    expect(r.gzippedBytes).toBe(gzipSync(body, { level: 9 }).byteLength);
  });

  it('collectMeasurements marks missing-path rows with `missing: true`', () => {
    fs.mkdirSync(path.join(tmpRoot, 'apps', 'api', 'dist'), { recursive: true });
    const realPath = 'apps/api/dist/worker.js';
    fs.writeFileSync(path.join(tmpRoot, realPath), Buffer.from('worker'));
    const sizeLimit = [
      { name: WORKER_BUNDLE_NAME, path: realPath, gzippedKb: 100 },
      { name: 'apps/web island', path: 'apps/web/dist/island.js', gzippedKb: 50 },
    ];
    const rows = collectMeasurements(sizeLimit, tmpRoot);
    expect(rows[0].missing).toBe(false);
    expect(rows[0].bundle).toBe(WORKER_BUNDLE_NAME);
    expect(rows[1].missing).toBe(true);
    expect(rows[1].bundle).toBe('apps/web island');
  });

  it('throws when a .size-limit.json entry is missing the name field', () => {
    expect(() => collectMeasurements([{ path: 'a.js' }], tmpRoot)).toThrow(/must carry a `name`/);
  });

  it('throws when a .size-limit.json entry is missing the path field', () => {
    expect(() => collectMeasurements([{ name: 'bundle-x' }], tmpRoot)).toThrow(
      /string `path` field/,
    );
  });
});

// ---------------------------------------------------------------------------
// rollupRows
// ---------------------------------------------------------------------------

describe('rollupRows', () => {
  it('sums rawKb and gzippedKb across scorable rows', () => {
    const r = rollupRows([
      { bundle: 'a', rawKb: 10, gzippedKb: 4, missing: false },
      { bundle: 'b', rawKb: 20, gzippedKb: 6, missing: false },
    ]);
    expect(r.totalKb).toBe(30);
    expect(r.gzippedKb).toBe(10);
  });

  it('excludes missing-path rows from the rollup', () => {
    const r = rollupRows([
      { bundle: 'a', rawKb: 10, gzippedKb: 4, missing: false },
      { bundle: 'b', rawKb: 999, gzippedKb: 999, missing: true },
    ]);
    expect(r.totalKb).toBe(10);
    expect(r.gzippedKb).toBe(4);
  });

  it('returns zeroes for an empty rows list', () => {
    expect(rollupRows([])).toEqual({ totalKb: 0, gzippedKb: 0 });
  });
});

// ---------------------------------------------------------------------------
// buildEnvelope — envelope shape + canonical sort
// ---------------------------------------------------------------------------

describe('buildEnvelope', () => {
  function fixedDate() {
    return new Date('2026-05-17T00:00:00.000Z');
  }

  it('emits $schema, kernelVersion, generatedAt, rollup, rows', () => {
    const env = buildEnvelope(
      {
        rows: [{ bundle: 'apps/web island', rawKb: 12, gzippedKb: 4, missing: false }],
      },
      fixedDate(),
    );
    expect(env.$schema).toBe(SCHEMA_POINTER);
    expect(env.kernelVersion).toBe(KERNEL_VERSION);
    expect(env.generatedAt).toBe('2026-05-17T00:00:00.000Z');
    expect(env.rollup['*']).toEqual({ totalKb: 12, gzippedKb: 4 });
    expect(env.rows).toHaveLength(1);
  });

  it('strips the `missing` flag from persisted rows', () => {
    const env = buildEnvelope(
      {
        rows: [{ bundle: 'a', rawKb: 1, gzippedKb: 1, missing: false }],
      },
      fixedDate(),
    );
    expect(env.rows[0]).not.toHaveProperty('missing');
  });

  it('drops missing-path rows from the persisted envelope', () => {
    const env = buildEnvelope(
      {
        rows: [
          { bundle: 'present', rawKb: 5, gzippedKb: 2, missing: false },
          { bundle: 'absent', rawKb: 0, gzippedKb: 0, missing: true },
        ],
      },
      fixedDate(),
    );
    expect(env.rows.map((r) => r.bundle)).toEqual(['present']);
  });

  it('sorts rows by bundle name lexicographically', () => {
    const env = buildEnvelope(
      {
        rows: [
          { bundle: 'z', rawKb: 1, gzippedKb: 1, missing: false },
          { bundle: 'a', rawKb: 1, gzippedKb: 1, missing: false },
          { bundle: 'm', rawKb: 1, gzippedKb: 1, missing: false },
        ],
      },
      fixedDate(),
    );
    expect(env.rows.map((r) => r.bundle)).toEqual(['a', 'm', 'z']);
  });

  it('is idempotent — re-building from the same rows yields equal output', () => {
    const rows = [
      { bundle: 'b', rawKb: 1, gzippedKb: 1, missing: false },
      { bundle: 'a', rawKb: 2, gzippedKb: 2, missing: false },
    ];
    const a = buildEnvelope({ rows }, fixedDate());
    const b = buildEnvelope({ rows: [...rows].reverse() }, fixedDate());
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// evaluateWorkerCap — ADR-014 1 MiB cap (AC #1 + AC #2)
// ---------------------------------------------------------------------------

describe('evaluateWorkerCap', () => {
  it('returns `ok` when no Worker row is present', () => {
    const rows = [{ bundle: 'apps/web island', rawKb: 10, gzippedKb: 4, missing: false }];
    expect(evaluateWorkerCap(rows).kind).toBe('ok');
  });

  it('returns `ok` when the Worker row is far below the cap', () => {
    const rows = [{ bundle: WORKER_BUNDLE_NAME, rawKb: 100, gzippedKb: 200, missing: false }];
    expect(evaluateWorkerCap(rows).kind).toBe('ok');
  });

  it('returns `warn` when the Worker compressed bytes are at 90% of cap', () => {
    // 90% of 1 MiB == 921.6 KiB; pick 922 KiB to land just over the
    // warn ratio without exceeding the cap.
    const rows = [{ bundle: WORKER_BUNDLE_NAME, rawKb: 3000, gzippedKb: 922, missing: false }];
    const r = evaluateWorkerCap(rows);
    expect(r.kind).toBe('warn');
    expect(r.ratio).toBeGreaterThanOrEqual(0.9);
    expect(r.ratio).toBeLessThan(1);
  });

  it('returns `fail` when the Worker compressed bytes exceed the 1 MiB cap (AC #1)', () => {
    // 1 MiB == 1024 KiB; pick 1025 KiB to land one KiB over the cap.
    const rows = [{ bundle: WORKER_BUNDLE_NAME, rawKb: 5000, gzippedKb: 1025, missing: false }];
    const r = evaluateWorkerCap(rows);
    expect(r.kind).toBe('fail');
    expect(r.bytes).toBeGreaterThan(WORKER_CAP_BYTES);
  });

  it('honours the cap regardless of the per-bundle budget (AC #1)', () => {
    // Even if .size-limit.json declared `gzippedKb: 9999` for the
    // Worker, evaluateWorkerCap fails on the raw compressed-bytes
    // measurement — the cap is independent of the budget.
    const rows = [{ bundle: WORKER_BUNDLE_NAME, rawKb: 5000, gzippedKb: 2048, missing: false }];
    expect(evaluateWorkerCap(rows).kind).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// compareBudgets — per-bundle gzippedKb enforcement
// ---------------------------------------------------------------------------

describe('compareBudgets', () => {
  it('returns no overruns when every row is within budget', () => {
    const rows = [
      { bundle: 'a', rawKb: 10, gzippedKb: 4, missing: false },
      { bundle: 'b', rawKb: 20, gzippedKb: 7, missing: false },
    ];
    const sizeLimit = [
      { name: 'a', path: 'a.js', gzippedKb: 5 },
      { name: 'b', path: 'b.js', gzippedKb: 10 },
    ];
    expect(compareBudgets(rows, sizeLimit)).toEqual([]);
  });

  it('flags a row whose gzippedKb exceeds its budget', () => {
    const rows = [{ bundle: 'a', rawKb: 10, gzippedKb: 8, missing: false }];
    const sizeLimit = [{ name: 'a', path: 'a.js', gzippedKb: 5 }];
    const overruns = compareBudgets(rows, sizeLimit);
    expect(overruns).toHaveLength(1);
    expect(overruns[0]).toMatchObject({ bundle: 'a', budget: 5, measured: 8 });
    expect(overruns[0].deltaKb).toBeGreaterThan(0);
  });

  it('skips missing-path rows', () => {
    const rows = [{ bundle: 'a', rawKb: 0, gzippedKb: 0, missing: true }];
    const sizeLimit = [{ name: 'a', path: 'a.js', gzippedKb: 5 }];
    expect(compareBudgets(rows, sizeLimit)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// compareRationaleAgainstBaseline — ADR-014 rationale-paired bump (AC #3)
// ---------------------------------------------------------------------------

describe('compareRationaleAgainstBaseline', () => {
  function baselineWith(rows) {
    return {
      $schema: SCHEMA_POINTER,
      kernelVersion: KERNEL_VERSION,
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: { '*': { totalKb: 0, gzippedKb: 0 } },
      rows,
    };
  }

  it('flags a bump that lacks a paired rationale field (AC #3)', () => {
    const baseline = baselineWith([{ bundle: 'a', rawKb: 10, gzippedKb: 5 }]);
    const sizeLimit = [{ name: 'a', path: 'a.js', gzippedKb: 8, lastRevised: '2026-05-18' }];
    const v = compareRationaleAgainstBaseline(sizeLimit, baseline);
    expect(v).toHaveLength(1);
    expect(v[0].bundle).toBe('a');
    expect(v[0].missingRationale).toBe(true);
  });

  it('flags a bump that lacks a paired lastRevised field (AC #3)', () => {
    const baseline = baselineWith([{ bundle: 'a', rawKb: 10, gzippedKb: 5 }]);
    const sizeLimit = [{ name: 'a', path: 'a.js', gzippedKb: 8, rationale: 'new dep X' }];
    const v = compareRationaleAgainstBaseline(sizeLimit, baseline);
    expect(v).toHaveLength(1);
    expect(v[0].missingLastRevised).toBe(true);
  });

  it('accepts a bump when rationale and lastRevised are both present', () => {
    const baseline = baselineWith([{ bundle: 'a', rawKb: 10, gzippedKb: 5 }]);
    const sizeLimit = [
      {
        name: 'a',
        path: 'a.js',
        gzippedKb: 8,
        rationale: 'dep X upgrade lands tree-shaken at +2 KiB',
        lastRevised: '2026-05-18',
      },
    ];
    expect(compareRationaleAgainstBaseline(sizeLimit, baseline)).toEqual([]);
  });

  it('ignores newly-declared bundles (no prior to compare against)', () => {
    const baseline = baselineWith([]);
    const sizeLimit = [{ name: 'brand-new', path: 'x.js', gzippedKb: 100 }];
    expect(compareRationaleAgainstBaseline(sizeLimit, baseline)).toEqual([]);
  });

  it('ignores budgets that hold or decrease', () => {
    const baseline = baselineWith([{ bundle: 'a', rawKb: 10, gzippedKb: 5 }]);
    const sizeLimit = [
      { name: 'a', path: 'a.js', gzippedKb: 5 }, // unchanged
      { name: 'b', path: 'b.js', gzippedKb: 3 }, // decreased (but no prior anyway)
    ];
    expect(compareRationaleAgainstBaseline(sizeLimit, baseline)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rejection-message formatters carry the rejection strings AC pins
// ---------------------------------------------------------------------------

describe('formatWorkerCapFailure', () => {
  it('embeds the ADR-014 rejection string', () => {
    const msg = formatWorkerCapFailure({ bytes: WORKER_CAP_BYTES + 1024, ratio: 1.001 });
    expect(msg).toMatch(/Worker 1 MiB cap exceeded/);
  });
});

describe('formatBudgetFailure', () => {
  it('names the bundle, budget, and measured value', () => {
    const msg = formatBudgetFailure([
      { bundle: 'apps/api worker', budget: 320, measured: 350, deltaKb: 30 },
    ]);
    expect(msg).toMatch(/apps\/api worker/);
    expect(msg).toMatch(/budget 320\.00 KiB/);
    expect(msg).toMatch(/350\.00 KiB/);
  });
});

describe('formatRationaleFailure', () => {
  it('names the missing fields per bundle', () => {
    const msg = formatRationaleFailure([
      { bundle: 'a', prior: 5, budget: 8, missingRationale: true, missingLastRevised: true },
    ]);
    expect(msg).toMatch(/`rationale` and `lastRevised`/);
  });
});

describe('formatWorkerCapWarning', () => {
  it('is non-fatal phrasing without the failure string', () => {
    const msg = formatWorkerCapWarning({ bytes: 940 * 1024, ratio: 0.918 });
    expect(msg).not.toMatch(/Worker 1 MiB cap exceeded/);
    expect(msg).toMatch(/91\.8%/);
  });
});

// ---------------------------------------------------------------------------
// readSizeLimit
// ---------------------------------------------------------------------------

describe('readSizeLimit', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-size-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('throws when the file is missing', () => {
    expect(() => readSizeLimit(path.join(tmpRoot, 'missing.json'))).toThrow(/missing/);
  });

  it('throws on invalid JSON', () => {
    const p = path.join(tmpRoot, '.size-limit.json');
    fs.writeFileSync(p, '{not json');
    expect(() => readSizeLimit(p)).toThrow(/not valid JSON/);
  });

  it('throws when the top-level value is not an array', () => {
    const p = path.join(tmpRoot, '.size-limit.json');
    fs.writeFileSync(p, '{}');
    expect(() => readSizeLimit(p)).toThrow(/array/);
  });

  it('returns the parsed array on success', () => {
    const p = path.join(tmpRoot, '.size-limit.json');
    fs.writeFileSync(p, JSON.stringify([{ name: 'a', path: 'a.js', gzippedKb: 1 }]));
    const parsed = readSizeLimit(p);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// modeCheck / modeUpdate — disk-backed end-to-end behaviour
// ---------------------------------------------------------------------------

describe('modeCheck / modeUpdate (disk-backed)', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-size-test-'));
    fs.mkdirSync(path.join(tmpRoot, 'baselines'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeSizeLimit(arr) {
    fs.writeFileSync(path.join(tmpRoot, '.size-limit.json'), JSON.stringify(arr));
  }

  function writeBaseline(rows) {
    const env = {
      $schema: SCHEMA_POINTER,
      kernelVersion: KERNEL_VERSION,
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: { '*': { totalKb: 0, gzippedKb: 0 } },
      rows,
    };
    fs.writeFileSync(
      path.join(tmpRoot, 'baselines', 'bundle-size.json'),
      `${JSON.stringify(env, null, 2)}\n`,
    );
  }

  function writeBundle(relPath, body) {
    const abs = path.join(tmpRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }

  it('--check passes when no measurable bundles exist (graceful no-op)', () => {
    writeSizeLimit([{ name: 'a', path: 'apps/api/dist/worker.js', gzippedKb: 100 }]);
    writeBaseline([]);
    expect(modeCheck({ repoRoot: tmpRoot })).toBe(0);
  });

  it('--check fails when the Worker exceeds the 1 MiB cap (AC #1)', async () => {
    // Worst-case incompressible Worker bundle — write ~1.2 MiB of
    // cryptographic random bytes so gzip cannot shrink it under the
    // cap.
    const { randomBytes } = await import('node:crypto');
    const buf = randomBytes(1024 * 1024 + 256 * 1024);
    writeBundle('apps/api/dist/worker.js', buf);
    writeSizeLimit([
      // Generous per-bundle budget so the Worker cap fires
      // independently of compareBudgets.
      { name: WORKER_BUNDLE_NAME, path: 'apps/api/dist/worker.js', gzippedKb: 99999 },
    ]);
    writeBaseline([]);
    expect(modeCheck({ repoRoot: tmpRoot })).toBe(1);
  });

  it('--check fails when a per-bundle bump lacks paired rationale (AC #3)', () => {
    writeBundle('apps/api/dist/worker.js', Buffer.from('w'.repeat(200)));
    writeSizeLimit([
      // Bump from prior baseline (gzippedKb: 0.05 ≈ 50 bytes) to 50 KiB
      // without rationale.
      { name: WORKER_BUNDLE_NAME, path: 'apps/api/dist/worker.js', gzippedKb: 50 },
    ]);
    writeBaseline([{ bundle: WORKER_BUNDLE_NAME, rawKb: 0.2, gzippedKb: 0.05 }]);
    expect(modeCheck({ repoRoot: tmpRoot })).toBe(1);
  });

  it('--check passes when bumps carry paired rationale + lastRevised', () => {
    writeBundle('apps/api/dist/worker.js', Buffer.from('w'.repeat(200)));
    writeSizeLimit([
      {
        name: WORKER_BUNDLE_NAME,
        path: 'apps/api/dist/worker.js',
        gzippedKb: 50,
        rationale: 'dep X tree-shaken; +0.5 KiB',
        lastRevised: '2026-05-18',
        approvedBy: '@dsj1984',
      },
    ]);
    writeBaseline([{ bundle: WORKER_BUNDLE_NAME, rawKb: 0.2, gzippedKb: 0.05 }]);
    expect(modeCheck({ repoRoot: tmpRoot })).toBe(0);
  });

  it('--update regenerates the baseline file with the envelope shape', () => {
    writeBundle('apps/api/dist/worker.js', Buffer.from('w'.repeat(1024)));
    writeSizeLimit([{ name: WORKER_BUNDLE_NAME, path: 'apps/api/dist/worker.js', gzippedKb: 100 }]);
    expect(modeUpdate({ repoRoot: tmpRoot, now: new Date('2026-05-17T00:00:00.000Z') })).toBe(0);
    const persisted = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, 'baselines', 'bundle-size.json'), 'utf8'),
    );
    expect(persisted.$schema).toBe(SCHEMA_POINTER);
    expect(persisted.kernelVersion).toBe(KERNEL_VERSION);
    expect(persisted.generatedAt).toBe('2026-05-17T00:00:00.000Z');
    expect(persisted.rollup['*']).toHaveProperty('totalKb');
    expect(persisted.rollup['*']).toHaveProperty('gzippedKb');
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].bundle).toBe(WORKER_BUNDLE_NAME);
  });

  it('--update emits byte-identical output across runs against an unchanged tree', () => {
    writeBundle('apps/api/dist/worker.js', Buffer.from('w'.repeat(1024)));
    writeSizeLimit([{ name: WORKER_BUNDLE_NAME, path: 'apps/api/dist/worker.js', gzippedKb: 100 }]);
    modeUpdate({ repoRoot: tmpRoot, now: new Date('2026-05-17T00:00:00.000Z') });
    const first = fs.readFileSync(path.join(tmpRoot, 'baselines', 'bundle-size.json'), 'utf8');
    modeUpdate({ repoRoot: tmpRoot, now: new Date('2026-05-17T00:00:00.000Z') });
    const second = fs.readFileSync(path.join(tmpRoot, 'baselines', 'bundle-size.json'), 'utf8');
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// serialise — sorted keys + trailing newline
// ---------------------------------------------------------------------------

describe('serialise', () => {
  it('sorts keys at every depth', () => {
    const env = {
      rollup: { '*': { totalKb: 1, gzippedKb: 2 } },
      generatedAt: 'now',
      kernelVersion: KERNEL_VERSION,
      $schema: SCHEMA_POINTER,
      rows: [],
    };
    const out = serialise(env);
    // Keys appear alphabetised at the top level: $schema before
    // generatedAt before kernelVersion before rollup before rows.
    const lines = out.split('\n');
    const keyLines = lines.filter((l) => l.match(/^ {2}"/));
    const order = keyLines.map((l) => l.match(/^ {2}"([^"]+)"/)?.[1]);
    expect(order).toEqual(['$schema', 'generatedAt', 'kernelVersion', 'rollup', 'rows']);
  });

  it('ends with a trailing newline', () => {
    const out = serialise({
      $schema: SCHEMA_POINTER,
      kernelVersion: KERNEL_VERSION,
      generatedAt: 'now',
      rollup: { '*': { totalKb: 0, gzippedKb: 0 } },
      rows: [],
    });
    expect(out.endsWith('\n')).toBe(true);
  });
});
