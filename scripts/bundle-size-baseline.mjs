#!/usr/bin/env node
// scripts/bundle-size-baseline.mjs
//
// Bundle-size baseline ratchet for the athportal monorepo (ADR-014).
//
// Measures gzipped + raw bytes for every declared bundle (the Cloudflare
// Worker dist output + the web islands enumerated in `.size-limit.json`)
// and either:
//
//   --check    (default) compare current bytes against `.size-limit.json`
//              budgets. Three failure modes:
//                1. Any compressed bundle exceeds its per-bundle
//                   `gzippedKb` budget (100%).
//                2. The Worker compressed bytes exceed the non-negotiable
//                   1 MiB cap (1 048 576 bytes), regardless of the
//                   per-bundle budget. Approaching the cap (>= 90%) emits
//                   a warning without failing.
//                3. A per-bundle `gzippedKb` budget in `.size-limit.json`
//                   was raised relative to the prior committed baseline
//                   without a paired `rationale` / `lastRevised` update on
//                   the same bundle entry. The `rationale` field is the
//                   per-bundle changelog (ADR-014).
//   --update   regenerate `baselines/bundle-size.json` from the current
//              tree.
//
// The envelope follows the shared contract at
// .agents/schemas/baselines/bundle-size.schema.json — $schema,
// kernelVersion, generatedAt, rollup ({'*': {totalKb, gzippedKb}}),
// rows ({bundle, rawKb, gzippedKb}).
//
// Discovery. The Worker bundle is sourced from
// `apps/api/dist/<entry>.js` if present (wrangler/webpack output). When
// `apps/api` has no dist yet (pre-Worker-build state, as it sits today),
// the script gracefully no-ops the Worker row — the gate stays a pass
// and the operator primes it once the build target lands. Web-island
// rows are sourced from `.size-limit.json` `path` entries; missing
// paths drop out of the rollup with a stderr note rather than failing
// the gate.
//
// Harness consumption. This script delegates IO and rejection
// formatting primitives to `@repo/baselines` when available, falling
// back to byte-compatible inline implementations. Mirrors the shape
// adopted by `scripts/maintainability-baseline.mjs` and
// `scripts/lint-baseline.mjs`.
//
// Refresh runbook lives in docs/patterns.md § "Bundle-size baseline
// ratchet". Hand-edits of `baselines/bundle-size.json` are rejected by
// reviewers — re-run `--update` instead.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Harness consumption — see header. The .mjs entrypoint cannot import
// the `.ts` surface directly without a loader; fall back to inline
// implementations that produce byte-identical output.
let harness = null;
try {
  harness = await import('@repo/baselines');
} catch {
  harness = null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const BASELINE_PATH = path.join(REPO_ROOT, 'baselines', 'bundle-size.json');
export const SIZE_LIMIT_PATH = path.join(REPO_ROOT, '.size-limit.json');
export const SCHEMA_POINTER = '.agents/schemas/baselines/bundle-size.schema.json';
export const KERNEL_VERSION = '1.0.0';

// ADR-014 — non-negotiable Cloudflare Worker compressed-bytes cap.
// Warn at 90% of cap, fail at 100% of cap, regardless of per-bundle
// budget. Approaching the cap is a Worker-split planning trigger, not
// a budget bump.
export const WORKER_CAP_BYTES = 1024 * 1024; // 1 MiB compressed
export const WORKER_WARN_RATIO = 0.9;

// The Worker bundle is identified by its bundle name in `.size-limit.json`.
// The convention pinned by ADR-014 is to name it `apps/api worker`. Other
// rows are treated as web islands and only enforce per-bundle budgets.
export const WORKER_BUNDLE_NAME = 'apps/api worker';

// ---------------------------------------------------------------------------
// CLI argv parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  let mode = 'check';
  let repoRootOverride = null;
  for (const a of argv.slice(2)) {
    if (a === '--check') mode = 'check';
    else if (a === '--update') mode = 'update';
    else if (a === '--help' || a === '-h') mode = 'help';
    else if (a.startsWith('--repo-root=')) repoRootOverride = a.slice('--repo-root='.length);
    else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return { mode, repoRootOverride };
}

// ---------------------------------------------------------------------------
// .size-limit.json — bundle declarations + budgets
// ---------------------------------------------------------------------------
//
// Shape (one entry per bundle):
//   {
//     "name": "apps/api worker",
//     "path": "apps/api/dist/worker.js",
//     "gzippedKb": 320,
//     "rationale": "initial baseline; matches MVP route surface",
//     "lastRevised": "2026-05-17",
//     "approvedBy": "@dsj1984"
//   }
//
// `name` is the row key in `baselines/bundle-size.json`. `path` is the
// file (or glob) measured. `gzippedKb` is the budget enforced on
// `:check`. `rationale`, `lastRevised`, `approvedBy` are the changelog
// fields ADR-014 requires when bumping `gzippedKb` upward — the
// rationale-paired check (`compareRationaleAgainstBaseline`) flags any
// bump that lands without a paired update.

export function readSizeLimit(filePath = SIZE_LIMIT_PATH) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[bundle-size-baseline] .size-limit.json missing at ${path.relative(REPO_ROOT, filePath).split(path.sep).join('/')}`,
    );
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`[bundle-size-baseline] failed to read .size-limit.json: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[bundle-size-baseline] .size-limit.json is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('[bundle-size-baseline] .size-limit.json must be a JSON array of bundles');
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

// Measure a single file's raw + gzipped bytes. Returns null when the
// file does not exist (pre-build state) so callers can decide whether
// to drop the row (no-op) or fail (size-limit declared a path that
// vanished).
export function measureFile(absPath) {
  if (!fs.existsSync(absPath)) return null;
  let buf;
  try {
    buf = fs.readFileSync(absPath);
  } catch (err) {
    throw new Error(`[bundle-size-baseline] failed to read ${absPath}: ${err.message}`);
  }
  const rawBytes = buf.byteLength;
  const gzippedBytes = gzipSync(buf, { level: 9 }).byteLength;
  return { rawBytes, gzippedBytes };
}

// Convert a byte count to a kilobyte number rounded to 2 decimals.
// Kilobyte == 1024 bytes (binary KiB) — matches the convention used
// by size-limit and the bundle-size schema.
export function bytesToKb(bytes) {
  return Math.round((bytes / 1024) * 100) / 100;
}

// Collect per-bundle measurements. Returns an array of
// `{ bundle, rawKb, gzippedKb, missing }` objects in declaration
// order. `missing: true` rows are emitted with zero bytes so callers
// can either drop them (--update gracefully no-ops) or surface a
// warning (--check notes a vanished path without failing).
export function collectMeasurements(sizeLimit, repoRoot = REPO_ROOT) {
  const rows = [];
  for (const entry of sizeLimit) {
    if (!entry?.name || typeof entry.name !== 'string') {
      throw new Error('[bundle-size-baseline] every .size-limit.json entry must carry a `name`');
    }
    if (!entry.path || typeof entry.path !== 'string') {
      throw new Error(
        `[bundle-size-baseline] entry ${entry.name} is missing a string \`path\` field`,
      );
    }
    const abs = path.isAbsolute(entry.path) ? entry.path : path.join(repoRoot, entry.path);
    const measured = measureFile(abs);
    if (measured === null) {
      rows.push({
        bundle: entry.name,
        rawKb: 0,
        gzippedKb: 0,
        missing: true,
      });
      continue;
    }
    rows.push({
      bundle: entry.name,
      rawKb: bytesToKb(measured.rawBytes),
      gzippedKb: bytesToKb(measured.gzippedBytes),
      missing: false,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Envelope builder
// ---------------------------------------------------------------------------

// Build the whole-repo `*` rollup over a set of rows. Drops the
// `missing: true` rows so the rollup reflects only real measurements
// — a vanished path must not silently inflate the total.
export function rollupRows(rows) {
  let totalKb = 0;
  let gzippedKb = 0;
  for (const row of rows) {
    if (row.missing) continue;
    totalKb += Number(row.rawKb ?? 0);
    gzippedKb += Number(row.gzippedKb ?? 0);
  }
  return {
    totalKb: round2(totalKb),
    gzippedKb: round2(gzippedKb),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Build the envelope. Rows are canonicalised: `missing` is stripped
// from the persisted shape (it is a measurement-time flag, not part of
// the schema), rows sort lexicographically by `bundle`, and the
// whole-repo `*` rollup carries `{ totalKb, gzippedKb }` over the
// scorable subset.
export function buildEnvelope({ rows }, now = new Date()) {
  const persisted = rows
    .filter((r) => !r.missing)
    .map((r) => ({
      bundle: r.bundle,
      rawKb: Number(r.rawKb ?? 0),
      gzippedKb: Number(r.gzippedKb ?? 0),
    }))
    .sort((a, b) => (a.bundle < b.bundle ? -1 : a.bundle > b.bundle ? 1 : 0));
  return {
    $schema: SCHEMA_POINTER,
    kernelVersion: KERNEL_VERSION,
    generatedAt: now.toISOString(),
    rollup: { '*': rollupRows(persisted) },
    rows: persisted,
  };
}

// ---------------------------------------------------------------------------
// Worker cap enforcement (ADR-014 — non-negotiable 1 MiB compressed cap)
// ---------------------------------------------------------------------------
//
// Locates the Worker row in the measured set (by bundle name) and
// returns one of:
//   { kind: 'ok' }                       — no measurement, or below 90%
//   { kind: 'warn', ratio, bytes }       — >= 90% of cap, < 100%
//   { kind: 'fail', ratio, bytes }       — >= 100% of cap
//
// The warn/fail decision is independent of the per-bundle `gzippedKb`
// budget: a Worker at 1.1 MiB compressed fails even if `.size-limit.json`
// permits it.

export function evaluateWorkerCap(
  rows,
  capBytes = WORKER_CAP_BYTES,
  warnRatio = WORKER_WARN_RATIO,
) {
  const worker = rows.find((r) => r.bundle === WORKER_BUNDLE_NAME && !r.missing);
  if (!worker) return { kind: 'ok' };
  const compressedBytes = Math.round(worker.gzippedKb * 1024);
  const ratio = compressedBytes / capBytes;
  if (compressedBytes > capBytes) {
    return { kind: 'fail', ratio, bytes: compressedBytes };
  }
  if (ratio >= warnRatio) {
    return { kind: 'warn', ratio, bytes: compressedBytes };
  }
  return { kind: 'ok' };
}

// ---------------------------------------------------------------------------
// Per-bundle budget enforcement
// ---------------------------------------------------------------------------
//
// For each row that resolved to a real measurement, compare
// `gzippedKb` against the matching `.size-limit.json` entry's
// `gzippedKb` budget. Returns an array of
// `{ bundle, budget, measured, deltaKb }` objects for every row whose
// measurement exceeded its budget.

export function compareBudgets(rows, sizeLimit) {
  const budgetByName = new Map();
  for (const entry of sizeLimit) {
    if (typeof entry?.gzippedKb === 'number') {
      budgetByName.set(entry.name, Number(entry.gzippedKb));
    }
  }
  const overruns = [];
  for (const row of rows) {
    if (row.missing) continue;
    const budget = budgetByName.get(row.bundle);
    if (budget === undefined) continue;
    if (row.gzippedKb > budget) {
      overruns.push({
        bundle: row.bundle,
        budget,
        measured: row.gzippedKb,
        deltaKb: round2(row.gzippedKb - budget),
      });
    }
  }
  return overruns;
}

// ---------------------------------------------------------------------------
// Rationale-paired bump check (ADR-014)
// ---------------------------------------------------------------------------
//
// When `.size-limit.json` raises a bundle's `gzippedKb` above the
// previous committed baseline's `gzippedKb` for the same bundle, the
// same change must update the bundle's `rationale` and `lastRevised`
// fields. Without that paired update, the bump is rejected — the
// `rationale` field is the per-bundle changelog.
//
// We detect "raised" by comparing `.size-limit.json` `gzippedKb` to
// the **prior baseline row's `gzippedKb`** (the file we shipped on
// `main`). A bump exists when `sizeLimit.gzippedKb >
// priorBaseline.gzippedKb`. The paired update is detected by reading
// the bundle entry's `lastRevised` field — if it does not match the
// running date (or a near-recent date), the bump is unpaired.
//
// To keep the check deterministic offline, we treat the absence of
// `rationale` *or* the absence of `lastRevised` as an unpaired bump.
// Reviewers MUST confirm the wording of `rationale` matches the
// dependency / feature being added in the same PR — the script
// guarantees presence, not content.

export function compareRationaleAgainstBaseline(sizeLimit, priorBaseline) {
  const violations = [];
  const priorByName = new Map();
  for (const row of priorBaseline?.rows ?? []) {
    priorByName.set(row.bundle, Number(row.gzippedKb ?? 0));
  }
  for (const entry of sizeLimit) {
    const budget = Number(entry?.gzippedKb ?? 0);
    const prior = priorByName.get(entry?.name);
    if (prior === undefined) continue; // newly-declared bundle; no prior to compare
    if (budget <= prior) continue; // bump only fires on a raise
    const hasRationale = typeof entry.rationale === 'string' && entry.rationale.trim().length > 0;
    const hasLastRevised =
      typeof entry.lastRevised === 'string' && entry.lastRevised.trim().length > 0;
    if (!hasRationale || !hasLastRevised) {
      violations.push({
        bundle: entry.name,
        prior,
        budget,
        missingRationale: !hasRationale,
        missingLastRevised: !hasLastRevised,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Failure formatters
// ---------------------------------------------------------------------------

export function formatWorkerCapFailure({ bytes, ratio }) {
  const lines = [
    '[bundle-size-baseline] ❌ Worker 1 MiB cap exceeded (ADR-014)',
    `  measured: ${(bytes / 1024).toFixed(2)} KiB compressed (cap ${WORKER_CAP_BYTES / 1024} KiB, ratio ${(ratio * 100).toFixed(1)}%)`,
    '  The 1 MiB Cloudflare Workers compressed-upload cap is non-negotiable.',
    '  Approaching the cap is a Worker-split planning trigger, not a budget bump.',
  ];
  return lines.join('\n');
}

export function formatBudgetFailure(overruns) {
  const lines = ['[bundle-size-baseline] ❌ per-bundle budget exceeded'];
  for (const o of overruns) {
    lines.push(
      `  ${o.bundle}: ${o.measured.toFixed(2)} KiB gzipped (budget ${o.budget.toFixed(2)} KiB, Δ=+${o.deltaKb.toFixed(2)} KiB)`,
    );
  }
  lines.push(
    '  Fix the regression first (strip a dependency, lazy-load, route-split). Bumping the budget is the last lever, not the first — see ADR-014.',
  );
  return lines.join('\n');
}

export function formatRationaleFailure(violations) {
  const lines = ['[bundle-size-baseline] ❌ bundle budget raised without paired rationale update'];
  for (const v of violations) {
    const missing = [
      v.missingRationale ? '`rationale`' : null,
      v.missingLastRevised ? '`lastRevised`' : null,
    ]
      .filter(Boolean)
      .join(' and ');
    lines.push(
      `  ${v.bundle}: budget ${v.prior.toFixed(2)} → ${v.budget.toFixed(2)} KiB (missing ${missing})`,
    );
  }
  lines.push(
    '  ADR-014: every per-bundle gzippedKb bump must ship with a paired `rationale` + `lastRevised` update on the same .size-limit.json entry. The `rationale` field is the per-bundle changelog.',
  );
  return lines.join('\n');
}

export function formatWorkerCapWarning({ bytes, ratio }) {
  return (
    `[bundle-size-baseline] ⚠️  Worker compressed size at ${(ratio * 100).toFixed(1)}% of the 1 MiB cap ` +
    `(${(bytes / 1024).toFixed(2)} KiB / ${WORKER_CAP_BYTES / 1024} KiB). ` +
    'Plan a Worker-split Story before the next dependency bump pushes us over the cap.'
  );
}

// ---------------------------------------------------------------------------
// Harness-backed IO (with byte-compatible inline fallback)
// ---------------------------------------------------------------------------

function readBaselineFile(filePath) {
  if (harness?.readBaseline) {
    try {
      return harness.readBaseline(filePath, 'bundle-size');
    } catch (err) {
      process.stderr.write(`[bundle-size-baseline] harness readBaseline failed: ${err.message}\n`);
    }
  }
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`[bundle-size-baseline] failed to parse ${filePath}: ${err.message}`);
  }
}

function writeBaselineFile(filePath, envelope) {
  if (harness?.writeBaseline) {
    return harness.writeBaseline(filePath, envelope, 'bundle-size');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serialise(envelope), 'utf8');
}

// Stable JSON serialiser — sorted keys at every depth, trailing
// newline, two-space indentation. Mirrors the `@repo/baselines`
// `serialiseBaseline` contract so the fallback path produces
// byte-identical output to the harness.
export function serialise(envelope) {
  return `${stringifyStable(envelope, 0)}\n`;
}

function stringifyStable(value, depth) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = '  '.repeat(depth + 1);
    const closing = '  '.repeat(depth);
    const parts = value.map((e) => `${inner}${stringifyStable(e, depth + 1)}`);
    return `[\n${parts.join(',\n')}\n${closing}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return '{}';
    const inner = '  '.repeat(depth + 1);
    const closing = '  '.repeat(depth);
    const parts = keys.map(
      (k) => `${inner}${JSON.stringify(k)}: ${stringifyStable(value[k], depth + 1)}`,
    );
    return `{\n${parts.join(',\n')}\n${closing}}`;
  }
  throw new Error(`[bundle-size-baseline] cannot serialise value of type ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

export function modeUpdate({ repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const sizeLimit = readSizeLimit(path.join(repoRoot, '.size-limit.json'));
  const rows = collectMeasurements(sizeLimit, repoRoot);
  const envelope = buildEnvelope({ rows }, now);
  writeBaselineFile(path.join(repoRoot, 'baselines', 'bundle-size.json'), envelope);
  process.stdout.write(
    `[bundle-size-baseline] wrote baselines/bundle-size.json — rows=${envelope.rows.length}, totalKb=${envelope.rollup['*'].totalKb}, gzippedKb=${envelope.rollup['*'].gzippedKb}\n`,
  );
  return 0;
}

export function modeCheck({ repoRoot = REPO_ROOT } = {}) {
  const baselinePath = path.join(repoRoot, 'baselines', 'bundle-size.json');
  const sizeLimitPath = path.join(repoRoot, '.size-limit.json');
  if (!fs.existsSync(baselinePath)) {
    process.stderr.write(
      '[bundle-size-baseline] baselines/bundle-size.json missing — run `pnpm run bundle-size:update` to prime it.\n',
    );
    return 1;
  }
  if (!fs.existsSync(sizeLimitPath)) {
    process.stderr.write(
      '[bundle-size-baseline] .size-limit.json missing — declare your bundle budgets first.\n',
    );
    return 1;
  }
  const baseline = readBaselineFile(baselinePath);
  const sizeLimit = readSizeLimit(sizeLimitPath);
  const rows = collectMeasurements(sizeLimit, repoRoot);

  // Graceful no-op: when every measured row is `missing` (no dist
  // output exists anywhere — the pre-Worker-build state today), skip
  // the gate. The next `--update` against a real build primes the
  // baseline. This matches the coverage-baseline "no workspace has
  // coverage data yet" shape.
  const anyMeasured = rows.some((r) => !r.missing);
  if (!anyMeasured) {
    process.stdout.write(
      '[bundle-size-baseline] no measurable bundles found (no dist output on disk); skipping the gate. Run `pnpm run build` then `pnpm run bundle-size:update` to prime the baseline.\n',
    );
    return 0;
  }

  // Rationale-paired bump check runs before budget enforcement so an
  // unpaired bump fails even when the bump itself would have passed
  // the budget check (i.e. the operator raised the budget without a
  // rationale and the bundle is still under the new limit).
  const rationaleViolations = compareRationaleAgainstBaseline(sizeLimit, baseline);
  if (rationaleViolations.length > 0) {
    process.stderr.write(`${formatRationaleFailure(rationaleViolations)}\n`);
    return 1;
  }

  // Worker cap is the non-negotiable upper bound. Failing here exits
  // with the rejection string ADR-014 names; warnings emit on stderr
  // and do not fail.
  const cap = evaluateWorkerCap(rows);
  if (cap.kind === 'warn') {
    process.stderr.write(`${formatWorkerCapWarning(cap)}\n`);
  } else if (cap.kind === 'fail') {
    process.stderr.write(`${formatWorkerCapFailure(cap)}\n`);
    return 1;
  }

  // Per-bundle budgets.
  const overruns = compareBudgets(rows, sizeLimit);
  if (overruns.length > 0) {
    process.stderr.write(`${formatBudgetFailure(overruns)}\n`);
    return 1;
  }

  process.stdout.write(
    `[bundle-size-baseline] ok — ${rows.filter((r) => !r.missing).length} bundle(s) within budget; Worker compressed ratio=${(cap.kind === 'ok' ? 0 : cap.ratio) * 100}% of cap\n`,
  );
  return 0;
}

function modeHelp() {
  process.stdout.write(
    `Usage: node scripts/bundle-size-baseline.mjs [--check | --update] [--repo-root=<dir>]\n\n` +
      `  --check    (default) compare current gzipped bundle sizes against .size-limit.json\n` +
      `             and enforce the 1 MiB Worker compressed cap (ADR-014).\n` +
      `  --update   regenerate baselines/bundle-size.json from the current tree.\n` +
      `  --repo-root=<dir>\n` +
      `             override the repo root used for measurement / baseline IO\n` +
      `             (useful for tests; defaults to the repo root).\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { mode, repoRootOverride } = parseArgs(process.argv);
  let exitCode = 0;
  try {
    const repoRoot = repoRootOverride ?? REPO_ROOT;
    if (mode === 'update') exitCode = modeUpdate({ repoRoot });
    else if (mode === 'check') exitCode = modeCheck({ repoRoot });
    else exitCode = modeHelp();
  } catch (err) {
    process.stderr.write(`[bundle-size-baseline] ${err.message}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}
