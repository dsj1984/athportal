#!/usr/bin/env node
// scripts/maintainability-baseline.mjs
//
// Maintainability Index (MI) baseline ratchet for the athportal monorepo
// (ADR-019).
//
// Scans every JavaScript/TypeScript source file under apps/* and
// packages/* (excluding tests, fixtures, and build output), computes
// per-file MI via typhonjs-escomplex, and either:
//
//   --check    (default) compare the current rollup against
//              baselines/maintainability.json. Enforces the framework
//              default floor of `rollup['*'].min >= 70`. The failure log
//              names the file dragging the whole-repo min below the floor
//              so reviewers can land the fix on the responsible source.
//   --update   regenerate baselines/maintainability.json from the
//              current tree.
//
// The envelope follows the shared contract at
// .agents/schemas/baselines/maintainability.schema.json — $schema,
// kernelVersion, generatedAt, rollup (per-component keyed; `*` is the
// whole-repo rollup; `apps/<name>` and `packages/<name>` are
// auto-populated for each workspace folder discovered on disk), rows
// ({path, mi}).
//
// MI formula. The kernel delegates to typhonjs-escomplex, whose
// maintainability index follows the Microsoft Visual Studio variant
// (range 0–171, higher is better, derived from Halstead volume,
// cyclomatic complexity, and SLOC). TypeScript is parsed via the babel-
// parser's `typescript` plugin so .ts / .tsx files score identically to
// the equivalent JavaScript (type annotations introduce no control
// flow).
//
// Harness consumption — this script delegates IO, comparison, and
// rejection formatting to @repo/baselines (Story #210). The harness
// is in-repo as a workspace package and is always resolvable.
//
// Refresh runbook lives in docs/patterns.md § "Maintainability baseline
// ratchet". Hand-edits are rejected by reviewers — re-run --update
// instead.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import escomplex from 'typhonjs-escomplex';

// Harness consumption — @repo/baselines (Story #210) exports TypeScript
// source from `./src/index.ts`. Node ESM cannot resolve a `.ts`
// entrypoint at runtime without a loader, so this script imports the
// harness only when a transformed build is available and otherwise
// falls back to an inline implementation that mirrors the harness
// contract byte-for-byte. The fallback path is exercised by the
// AC-pinning unit tests today; the harness path becomes live once the
// `@repo/baselines` package ships a built `./dist` entrypoint. This
// mirrors the shape adopted by `scripts/crap-baseline.mjs` and
// `scripts/lint-baseline.mjs`.
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
export const BASELINE_PATH = path.join(REPO_ROOT, 'baselines', 'maintainability.json');
export const SCHEMA_POINTER = '.agents/schemas/baselines/maintainability.schema.json';
export const KERNEL_VERSION = '1.0.0';
// Framework-default rollup `min` floor (ADR-019). MI is on a 0–171 scale
// where higher is better; the mandrel framework default of 70 catches
// "this file just regressed below the maintainability cliff" without
// blocking legitimately complex code that still sits above the floor.
export const MI_MIN_FLOOR = 70;

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  '__tests__',
  '__fixtures__',
  '.git',
  '.worktrees',
  'test-results',
  'playwright-report',
]);
const SKIP_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.test.js',
  '.test.mjs',
  '.test.cjs',
  '.spec.ts',
  '.spec.tsx',
  '.spec.js',
  '.spec.mjs',
  '.contract.test.ts',
  '.d.ts',
];

// ---------------------------------------------------------------------------
// CLI argv parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  let mode = 'check';
  let scanRoot = null;
  for (const a of argv.slice(2)) {
    if (a === '--check') mode = 'check';
    else if (a === '--update') mode = 'update';
    else if (a === '--help' || a === '-h') mode = 'help';
    else if (a.startsWith('--scan-root=')) scanRoot = a.slice('--scan-root='.length);
    else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return { mode, scanRoot };
}

// ---------------------------------------------------------------------------
// Source discovery
// ---------------------------------------------------------------------------

// Walk apps/* and packages/* (recursively) and return repo-relative
// POSIX paths to every scorable source file. The walker honours
// SKIP_DIRECTORIES and SKIP_FILE_SUFFIXES so tests, fixtures, build
// output, and ambient types stay out of the MI rollup.
export function discoverSources(repoRoot = REPO_ROOT) {
  const sources = [];
  for (const parent of ['apps', 'packages']) {
    const abs = path.join(repoRoot, parent);
    if (!fs.existsSync(abs)) continue;
    walk(abs, repoRoot, sources);
  }
  return sources.sort();
}

function walk(dir, repoRoot, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(name)) continue;
      if (name.startsWith('.')) continue;
      walk(path.join(dir, name), repoRoot, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isSkippedFile(name)) continue;
    const ext = path.extname(name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    const abs = path.join(dir, name);
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    out.push(rel);
  }
}

function isSkippedFile(name) {
  for (const suffix of SKIP_FILE_SUFFIXES) {
    if (name.endsWith(suffix)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// MI scoring (kernel)
// ---------------------------------------------------------------------------

// Score a JavaScript or TypeScript source string and return the file-
// level MI value. A parse error returns `null` — the file is treated as
// unscorable, NOT zero MI (the latter would be a phantom floor
// violation that no source change can fix). Callers skip null rows
// from the envelope so the rollup only reflects scorable files.
export function scoreSource(source) {
  let report;
  try {
    report = escomplex.analyzeModule(source, { typescript: true });
  } catch {
    return null;
  }
  const mi = report?.maintainability;
  if (typeof mi !== 'number' || !Number.isFinite(mi)) return null;
  return mi;
}

// ---------------------------------------------------------------------------
// Component resolution
// ---------------------------------------------------------------------------

// Resolve the component a row belongs to. Whole-repo rollup `*` covers
// every row; per-workspace components match the first two POSIX
// segments of the row's path (`apps/<name>`, `packages/<name>`). A row
// outside both trees is recorded under `*` only.
export function componentForRow(relPath) {
  const segments = relPath.split('/');
  if (segments.length < 2) return null;
  if (segments[0] === 'apps' || segments[0] === 'packages') {
    return `${segments[0]}/${segments[1]}`;
  }
  return null;
}

// Build the per-component rollup map. Keys are component names; values
// are `{ min, p50, p95 }`. The `*` key carries the whole-repo rollup
// and is always present, matching the schema's `required: ["*"]`
// contract.
export function rollupByComponent(rows) {
  const groups = new Map();
  groups.set('*', []);
  for (const row of rows) {
    groups.get('*').push(row.mi);
    const component = componentForRow(row.path);
    if (component !== null) {
      if (!groups.has(component)) groups.set(component, []);
      groups.get(component).push(row.mi);
    }
  }
  const rollup = {};
  for (const [name, values] of groups) {
    rollup[name] = rollupAxes(values);
  }
  return rollup;
}

// Compute `{ min, p50, p95 }` from a flat array of MI values. An empty
// list yields zero placeholders so the envelope still validates
// against the per-kind schema (which requires the three axes on every
// component).
export function rollupAxes(values) {
  if (values.length === 0) {
    return { min: 0, p50: 0, p95: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sortedAsc, q) {
  if (sortedAsc.length === 0) return 0;
  // Nearest-rank (no interpolation): the smallest value such that at
  // least `q` of the data falls at or below it. Matches the rollup
  // policy used by crap-baseline.mjs so successive baselines compare
  // cleanly across dimensions.
  const rank = Math.ceil(q * sortedAsc.length);
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, rank - 1));
  return sortedAsc[idx];
}

// ---------------------------------------------------------------------------
// Envelope builder
// ---------------------------------------------------------------------------

// Build the envelope. Rows are sorted by `path` canonically so
// successive `:update` runs against an unchanged tree produce byte-
// identical JSON.
export function buildEnvelope({ rows }, now = new Date()) {
  const sortedRows = [...rows].sort(compareRows);
  return {
    $schema: SCHEMA_POINTER,
    kernelVersion: KERNEL_VERSION,
    generatedAt: now.toISOString(),
    rollup: rollupByComponent(sortedRows),
    rows: sortedRows,
  };
}

function compareRows(a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function collectRows({ scanRoot, repoRoot = REPO_ROOT } = {}) {
  const root = scanRoot ?? repoRoot;
  const sources = discoverSources(root);
  const rows = [];
  for (const rel of sources) {
    const abs = path.join(root, rel);
    let src;
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const mi = scoreSource(src);
    if (mi === null) continue;
    rows.push({ path: rel, mi });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Floor enforcement (ADR-019 — framework-default rollup `*` min ≥ 70)
// ---------------------------------------------------------------------------

// Compare the current envelope against the configured floor. Returns
// `{ violation: false }` when the rollup `*` min is at or above the
// floor, or `{ violation: true, floor, current, worst }` when the
// floor is breached. `worst` names the row whose MI matches the
// whole-repo min — the file dragging the gate down (AC #1).
export function compareFloor(current, floor = MI_MIN_FLOOR) {
  const currentMin = Number(current?.rollup?.['*']?.min ?? 0);
  if (currentMin >= floor) {
    return { violation: false, floor, current: currentMin, worst: null };
  }
  const worst = pickWorstRow(current.rows ?? []);
  return { violation: true, floor, current: currentMin, worst };
}

function pickWorstRow(rows) {
  let worst = null;
  for (const row of rows) {
    if (typeof row?.mi !== 'number') continue;
    if (worst === null || row.mi < worst.mi) worst = row;
  }
  return worst;
}

export function formatFloorRejection({ floor, current, worst }) {
  const lines = ['[maintainability-baseline] ❌ rollup `*` min below the configured floor'];
  lines.push(`  rollup['*'].min: ${formatNumber(current)} (floor ${formatNumber(floor)})`);
  if (worst) {
    lines.push(
      `  worst file: ${worst.path} (mi=${formatNumber(worst.mi)}) — this is the file dragging the whole-repo min below the floor`,
    );
  }
  lines.push(
    '  Raise the MI on the worst file by reducing branches / shrinking the module, or — if the dip is intentional and approved — refresh the baseline via `pnpm run maintainability:update` (the floor is rooted in ADR-019, not the baseline).',
  );
  return lines.join('\n');
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toString();
  return Number.parseFloat(n.toFixed(4)).toString();
}

// ---------------------------------------------------------------------------
// Harness-backed IO (with byte-compatible inline fallback)
// ---------------------------------------------------------------------------

function readBaselineFile(filePath) {
  if (harness?.readBaseline) {
    try {
      return harness.readBaseline(filePath, 'maintainability');
    } catch (err) {
      process.stderr.write(
        `[maintainability-baseline] harness readBaseline failed: ${err.message}\n`,
      );
    }
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`[maintainability-baseline] failed to parse ${filePath}: ${err.message}`);
  }
}

function writeBaselineFile(filePath, envelope) {
  if (harness?.writeBaseline) {
    return harness.writeBaseline(filePath, envelope, 'maintainability');
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
  throw new Error(`[maintainability-baseline] cannot serialise value of type ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

export function modeUpdate({ scanRoot, repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const rows = collectRows({ scanRoot, repoRoot });
  const envelope = buildEnvelope({ rows }, now);
  writeBaselineFile(BASELINE_PATH, envelope);
  process.stdout.write(
    `[maintainability-baseline] wrote baselines/maintainability.json — rows=${rows.length}, rollup['*'].min=${formatNumber(envelope.rollup['*'].min)}\n`,
  );
  return 0;
}

export function modeCheck({ scanRoot, repoRoot = REPO_ROOT, now = new Date() } = {}) {
  if (!fs.existsSync(BASELINE_PATH)) {
    process.stderr.write(
      '[maintainability-baseline] baselines/maintainability.json missing — run `pnpm run maintainability:update` to prime it.\n',
    );
    return 1;
  }
  const baseline = readBaselineFile(BASELINE_PATH);

  // Unprimed baseline (empty rows + zero rollup) is treated as a green
  // light. The operator has not yet primed; the next `--update`
  // establishes the floor.
  const baselineIsUnprimed =
    baseline.rows.length === 0 &&
    baseline.rollup['*'].min === 0 &&
    baseline.rollup['*'].p50 === 0 &&
    baseline.rollup['*'].p95 === 0;
  if (baselineIsUnprimed) {
    process.stdout.write(
      '[maintainability-baseline] baseline is unprimed (no rows committed); skipping the gate. Run `pnpm run maintainability:update` to establish the rollup.\n',
    );
    return 0;
  }

  const rows = collectRows({ scanRoot, repoRoot });
  const current = buildEnvelope({ rows }, now);
  const result = compareFloor(current, MI_MIN_FLOOR);
  if (!result.violation) {
    process.stdout.write(
      `[maintainability-baseline] ok — rollup['*'].min=${formatNumber(result.current)} (floor ${formatNumber(MI_MIN_FLOOR)}, ${rows.length} file(s))\n`,
    );
    return 0;
  }
  process.stderr.write(`${formatFloorRejection(result)}\n`);
  return 1;
}

function modeHelp() {
  process.stdout.write(
    `Usage: node scripts/maintainability-baseline.mjs [--check | --update] [--scan-root=<dir>]\n\n` +
      `  --check    (default) compare the current rollup against baselines/maintainability.json\n` +
      `             and enforce the framework-default floor rollup['*'].min >= ${MI_MIN_FLOOR} (ADR-019)\n` +
      `  --update   regenerate baselines/maintainability.json from the current tree\n` +
      `  --scan-root=<dir>\n` +
      `             override the repo root used for source discovery\n` +
      `             (useful for tests; defaults to the repo root)\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { mode, scanRoot } = parseArgs(process.argv);
  let exitCode = 0;
  try {
    if (mode === 'update') exitCode = modeUpdate({ scanRoot });
    else if (mode === 'check') exitCode = modeCheck({ scanRoot });
    else exitCode = modeHelp();
  } catch (err) {
    process.stderr.write(`[maintainability-baseline] ${err.message}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}
