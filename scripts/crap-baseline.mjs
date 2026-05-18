#!/usr/bin/env node
// scripts/crap-baseline.mjs
//
// CRAP baseline ratchet for the athportal monorepo (ADR-018).
//
// Scans every JavaScript/TypeScript source file under apps/* and
// packages/* (excluding tests, fixtures, and build output), computes
// per-method CRAP scores via typhonjs-escomplex, and either:
//
//   --check    (default) compare against baselines/crap.json with a
//              per-method relative-5% tolerance (ADR-018); exit
//              non-zero if any method's CRAP score rose more than 5%
//              above the prior baseline value.
//   --update   regenerate baselines/crap.json from the current tree.
//
// The envelope follows the shared contract at
// .agents/schemas/baselines/crap.schema.json — $schema, kernelVersion,
// generatedAt, rollup ({'*': {p50, p95, max, methodsAbove20}}), rows
// ({path, method, startLine, crap}).
//
// CRAP formula: c² · (1 − cov)³ + c. Without per-method coverage
// integration (deferred to the maintainability/coverage cross-link
// Epic), `cov` is treated as 0 — the standard "untested" worst case
// that callers can lower by adding tests. The ratchet still catches
// complexity regressions because cyclomatic complexity dominates the
// formula at low coverage.
//
// Harness consumption — this script delegates IO, comparison, and
// rejection formatting to @repo/baselines (Story #210). The harness
// is in-repo as a workspace package and is always resolvable.
//
// Refresh runbook lives in docs/patterns.md § "CRAP baseline ratchet".
// Hand-edits are rejected by reviewers — re-run --update instead.

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
// `@repo/baselines` package ships a built `./dist` entrypoint.
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
export const BASELINE_PATH = path.join(REPO_ROOT, 'baselines', 'crap.json');
export const SCHEMA_POINTER = '.agents/schemas/baselines/crap.schema.json';
export const KERNEL_VERSION = '1.0.0';
export const TOLERANCE_PCT = 5; // ADR-018: relative-5% per-method ratchet
export const METHODS_ABOVE_20_THRESHOLD = 20; // shared crap-ceiling marker

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
// output, and ambient types stay out of the CRAP rollup.
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
// CRAP scoring (kernel)
// ---------------------------------------------------------------------------

// CRAP formula. With no coverage integration, coverage defaults to 0
// and the formula collapses to `c² + c`. The function still accepts a
// coverage ratio so future cross-baseline integration can pipe per-
// method statement coverage through without changing the contract.
export function crapFormula(cyclomatic, coverage = 0) {
  const c = Number(cyclomatic) || 0;
  const cov = Math.max(0, Math.min(1, Number(coverage) || 0));
  return c * c * (1 - cov) ** 3 + c;
}

// Score every method in a JavaScript source string. Returns an array
// of { method, startLine, crap }. A parse error returns an empty array
// — the file is treated as unscorable, not zero-complexity. TypeScript
// is parsed via the same toolchain (escomplex's babel-parser supports
// TS syntax).
export function scoreSource(source) {
  let report;
  try {
    report = escomplex.analyzeModule(source, { typescript: true });
  } catch {
    return [];
  }
  const methods = report?.methods ?? [];
  const rows = [];
  for (const m of methods) {
    const startLine = m?.lineStart;
    if (typeof startLine !== 'number') continue;
    const cyclomatic = m?.cyclomatic ?? 0;
    const methodName = typeof m?.name === 'string' && m.name.length > 0 ? m.name : '<anonymous>';
    rows.push({
      method: methodName,
      startLine,
      crap: crapFormula(cyclomatic, 0),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

// Compute the whole-repo rollup from a flat list of rows. p50 / p95 are
// percentile values of the row CRAP scores; max is the highest score;
// methodsAbove20 is the count of rows whose crap > 20 (the standard
// CRAP ceiling above which a method is flagged for refactor).
export function rollupRows(rows) {
  if (rows.length === 0) {
    return { p50: 0, p95: 0, max: 0, methodsAbove20: 0 };
  }
  const scores = rows.map((r) => r.crap).sort((a, b) => a - b);
  return {
    p50: percentile(scores, 0.5),
    p95: percentile(scores, 0.95),
    max: scores[scores.length - 1],
    methodsAbove20: rows.filter((r) => r.crap > METHODS_ABOVE_20_THRESHOLD).length,
  };
}

function percentile(sortedAsc, q) {
  if (sortedAsc.length === 0) return 0;
  // Nearest-rank (no interpolation): the smallest value such that at
  // least `q` of the data falls at or below it. Matches the
  // "methodsAbove20" cut policy and keeps the rollup integer-friendly.
  const rank = Math.ceil(q * sortedAsc.length);
  const idx = Math.max(0, Math.min(sortedAsc.length - 1, rank - 1));
  return sortedAsc[idx];
}

// ---------------------------------------------------------------------------
// Envelope builder
// ---------------------------------------------------------------------------

// Build the envelope. Rows are sorted by (path, startLine, method)
// canonically so successive `:update` runs against an unchanged tree
// produce byte-identical JSON (AC #1 from Task #214).
export function buildEnvelope({ rows }, now = new Date()) {
  const sortedRows = [...rows].sort(compareRows);
  return {
    $schema: SCHEMA_POINTER,
    kernelVersion: KERNEL_VERSION,
    generatedAt: now.toISOString(),
    rollup: { '*': rollupRows(sortedRows) },
    rows: sortedRows,
  };
}

function compareRows(a, b) {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  if (a.startLine !== b.startLine) return a.startLine - b.startLine;
  if (a.method !== b.method) return a.method < b.method ? -1 : 1;
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
    const methodRows = scoreSource(src);
    for (const r of methodRows) {
      rows.push({ path: rel, method: r.method, startLine: r.startLine, crap: r.crap });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tolerance comparison (ADR-018 — relative-5% per-method, lower-is-better)
// ---------------------------------------------------------------------------

// Per-method identifier: `path:startLine:method`. Two methods with the
// same name in the same file at different start lines are distinct
// rows; a refactor that moves a method down by one line is a row
// rename (new row appears, old row disappears) and is not flagged —
// removing a regression is never a regression.
export const ROW_IDENTIFIER_KEY = 'id';

function indexById(envelope) {
  const indexed = { ...envelope };
  indexed.rows = envelope.rows.map((r) => ({ ...r, id: rowId(r) }));
  return indexed;
}

function rowId(r) {
  return `${r.path}:${r.startLine}:${r.method}`;
}

export function compareCrap(prev, current) {
  const prevIndexed = indexById(prev);
  const currIndexed = indexById(current);
  const tolerance = { kind: 'relative-pct', pct: TOLERANCE_PCT };
  const config = {
    identifierKey: ROW_IDENTIFIER_KEY,
    axes: ['crap'],
    polarity: 'lower-is-better',
  };
  if (harness?.compareWithTolerance) {
    return harness.compareWithTolerance(prevIndexed, currIndexed, tolerance, config);
  }
  return compareWithToleranceFallback(prevIndexed, currIndexed, tolerance, config);
}

// Reviewer-facing rejection message — names file, method, and prev/next
// CRAP scores (AC #2 from Task #214).
export function formatCrapRejection(diffs) {
  if (harness?.formatRejectionMessage) {
    return harness.formatRejectionMessage('crap', diffs);
  }
  return formatRejectionMessageFallback('crap', diffs);
}

// ---------------------------------------------------------------------------
// Harness fallback — byte-compatible with @repo/baselines while the
// package ships TS-only sources without a built entrypoint.
// ---------------------------------------------------------------------------

function compareWithToleranceFallback(prev, next, tolerance, config) {
  const identifierKey = config.identifierKey ?? 'path';
  const prevByKey = new Map();
  for (const row of prev.rows ?? []) {
    const id = row?.[identifierKey];
    if (typeof id === 'string') prevByKey.set(id, row);
  }
  const diffs = [];
  for (const nextRow of next.rows ?? []) {
    const id = nextRow?.[identifierKey];
    if (typeof id !== 'string') continue;
    const prevRow = prevByKey.get(id);
    for (const axis of config.axes) {
      const nextValue = typeof nextRow[axis] === 'number' ? nextRow[axis] : 0;
      const prevValue = prevRow && typeof prevRow[axis] === 'number' ? prevRow[axis] : 0;
      const severity = evaluateFallback(tolerance, prevValue, nextValue, config.polarity);
      if (severity) {
        diffs.push({
          identifier: id,
          axis,
          prev: prevValue,
          next: nextValue,
          tolerance,
          severity,
          row: nextRow,
        });
      }
    }
  }
  return diffs;
}

function evaluateFallback(tolerance, prev, next, polarity) {
  if (tolerance.kind === 'relative-pct') {
    const pol = polarity ?? 'higher-is-better';
    if (prev === 0) {
      if (pol === 'higher-is-better') return null;
      return next > 0 ? 'fail' : null;
    }
    const allowed = (tolerance.pct / 100) * Math.abs(prev);
    if (pol === 'higher-is-better') {
      return next < prev - allowed ? 'fail' : null;
    }
    return next > prev + allowed ? 'fail' : null;
  }
  return null;
}

function formatRejectionMessageFallback(kind, diffs) {
  if (diffs.length === 0) return '';
  const lines = [];
  const failCount = diffs.filter((d) => d.severity === 'fail').length;
  const warnCount = diffs.length - failCount;
  const summary =
    warnCount === 0
      ? `${diffs.length} violation${diffs.length === 1 ? '' : 's'}`
      : `${failCount} fail · ${warnCount} warn`;
  lines.push(`[@repo/baselines] ${kind} baseline check failed: ${summary}`);
  for (const d of diffs) {
    const glyph = d.severity === 'fail' ? 'x' : '!';
    lines.push(
      `  ${glyph} (${d.severity}) ${d.identifier} · ${d.axis}: ${formatNumber(d.prev)} → ${formatNumber(d.next)}`,
    );
    const t = d.tolerance;
    lines.push(`      tolerance: relative-pct(pct=${formatNumber(t.pct)})`);
  }
  return lines.join('\n');
}

function formatNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toString();
  return Number.parseFloat(n.toFixed(4)).toString();
}

function readBaselineFile(filePath) {
  if (harness?.readBaseline) return harness.readBaseline(filePath, 'crap');
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`[crap-baseline] failed to parse ${filePath}: ${err.message}`);
  }
}

function writeBaselineFile(filePath, envelope) {
  if (harness?.writeBaseline) return harness.writeBaseline(filePath, envelope, 'crap');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serialise(envelope), 'utf8');
}

// Stable JSON serialiser — sorted keys at every depth, trailing
// newline, two-space indentation. Byte-identical re-emission across
// runs is the invariant; the harness writeBaseline enforces the same
// shape when it's available.
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
  throw new Error(`[crap-baseline] cannot serialise value of type ${typeof value}`);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

export function modeUpdate({ scanRoot, repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const rows = collectRows({ scanRoot, repoRoot });
  const envelope = buildEnvelope({ rows }, now);
  writeBaselineFile(BASELINE_PATH, envelope);
  process.stdout.write(
    `[crap-baseline] wrote baselines/crap.json — rows=${rows.length}, methodsAbove20=${envelope.rollup['*'].methodsAbove20}\n`,
  );
  return 0;
}

export function modeCheck({ scanRoot, repoRoot = REPO_ROOT, now = new Date() } = {}) {
  if (!fs.existsSync(BASELINE_PATH)) {
    process.stderr.write(
      '[crap-baseline] baselines/crap.json missing — run `pnpm run crap:update` to prime it.\n',
    );
    return 1;
  }
  const baseline = readBaselineFile(BASELINE_PATH);

  // Unprimed baseline (empty rows + zero rollup) is treated as a green
  // light. The operator has not yet primed; the next `--update`
  // establishes the floor.
  const baselineIsUnprimed =
    baseline.rows.length === 0 &&
    baseline.rollup['*'].max === 0 &&
    baseline.rollup['*'].methodsAbove20 === 0;
  if (baselineIsUnprimed) {
    process.stdout.write(
      '[crap-baseline] baseline is unprimed (no rows committed); skipping the gate. Run `pnpm run crap:update` to establish the floor.\n',
    );
    return 0;
  }

  const rows = collectRows({ scanRoot, repoRoot });
  const current = buildEnvelope({ rows }, now);
  const diffs = compareCrap(baseline, current);
  if (diffs.length === 0) {
    process.stdout.write(
      `[crap-baseline] ok — ${rows.length} method(s) within the ${TOLERANCE_PCT}% relative ceiling\n`,
    );
    return 0;
  }
  process.stderr.write(`${formatCrapRejection(diffs)}\n`);
  process.stderr.write(
    `  Fix the regression by reducing branches or adding tests, or — if the rise is intentional and approved — run \`pnpm run crap:update\` to lower the floor.\n`,
  );
  return 1;
}

function modeHelp() {
  process.stdout.write(
    `Usage: node scripts/crap-baseline.mjs [--check | --update] [--scan-root=<dir>]\n\n` +
      `  --check    (default) compare current CRAP scores against baselines/crap.json\n` +
      `             with a per-method ${TOLERANCE_PCT}% relative ceiling (ADR-018)\n` +
      `  --update   regenerate baselines/crap.json from the current tree\n` +
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
    process.stderr.write(`[crap-baseline] ${err.message}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}
