#!/usr/bin/env node
// scripts/coverage-baseline.mjs
//
// Coverage baseline ratchet for the athportal monorepo (ADR-015).
//
// Consumes Vitest's coverage-final.json reports (one per workspace under
// apps/* and packages/*), aggregates per-workspace line / branch / function
// coverage into the shared baseline envelope shape, and either:
//
//   --check    (default) compare against baselines/coverage.json with a
//              per-workspace -2pp absolute floor (ADR-015); exit non-zero
//              if any workspace's coverage drops more than 2 percentage
//              points on any of the three axes.
//   --update   regenerate baselines/coverage.json from the current tree.
//
// The envelope follows the shared contract at
// .agents/schemas/baselines/coverage.schema.json — $schema, kernelVersion,
// generatedAt, rollup ({'*': ..., '<workspace>': ...}), rows (per-file
// percentages).
//
// Harness consumption — when the @repo/baselines package (Story #210)
// resolves, this script delegates read/write/compare/format primitives to
// it. While Story #210 is in flight (parallel wave), the script falls
// back to an inline implementation so the AC-pinning unit tests run
// today. The fallback is byte-compatible with the harness contract; when
// the package lands, the fallback becomes dead code and is removed in a
// follow-up.
//
// Refresh runbook lives in docs/patterns.md § "Coverage baseline ratchet".
// Hand-edits are rejected by reviewers — re-run --update instead.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const BASELINE_PATH = path.join(REPO_ROOT, 'baselines', 'coverage.json');
export const SCHEMA_POINTER = '.agents/schemas/baselines/coverage.schema.json';
export const KERNEL_VERSION = '1.0.0';
export const TOLERANCE_PP = 2; // ADR-015: absolute -2pp per workspace per axis

// ---------------------------------------------------------------------------
// Harness consumption (with inline fallback while Story #210 lands)
// ---------------------------------------------------------------------------
//
// Per the Tech Spec, this script consumes @repo/baselines for envelope
// IO and tolerance comparison. Story #210 ships that package in a
// parallel wave. Use dynamic import with a fallback so this script and
// its AC-pinning tests run independently of Story #210's merge order.

let harness;
try {
  harness = await import('@repo/baselines');
} catch {
  harness = null;
}

function readBaseline(filePath) {
  if (harness?.readBaseline) return harness.readBaseline(filePath, 'coverage');
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`[coverage-baseline] failed to parse ${filePath}: ${err.message}`);
  }
}

function writeBaseline(filePath, envelope) {
  if (harness?.writeBaseline) return harness.writeBaseline(filePath, envelope);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serialise(envelope), 'utf8');
}

// ---------------------------------------------------------------------------
// CLI argv parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  let mode = 'check';
  let coverageRoot = null;
  for (const a of argv.slice(2)) {
    if (a === '--check') mode = 'check';
    else if (a === '--update') mode = 'update';
    else if (a === '--help' || a === '-h') mode = 'help';
    else if (a.startsWith('--coverage-root=')) coverageRoot = a.slice('--coverage-root='.length);
    else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return { mode, coverageRoot };
}

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

// Returns the list of workspace directories declared via pnpm-workspace.yaml
// (apps/* and packages/*), resolved against REPO_ROOT and sorted lex.
export function discoverWorkspaces(repoRoot = REPO_ROOT) {
  const dirs = [];
  for (const parent of ['apps', 'packages']) {
    const abs = path.join(repoRoot, parent);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgJson = path.join(abs, entry.name, 'package.json');
      if (!fs.existsSync(pkgJson)) continue;
      dirs.push(`${parent}/${entry.name}`);
    }
  }
  return dirs.sort();
}

// ---------------------------------------------------------------------------
// Coverage parsing
// ---------------------------------------------------------------------------

// Returns the path to a workspace's coverage-final.json (relative to the
// workspace root), or null when the workspace has not yet produced
// coverage output.
function workspaceCoverageFinal(wsDir, repoRoot = REPO_ROOT) {
  const p = path.join(repoRoot, wsDir, 'coverage', 'coverage-final.json');
  return fs.existsSync(p) ? p : null;
}

// Parse a single coverage-final.json file (Istanbul/V8 shape) and yield
// per-file aggregate counts for lines, branches, functions. The shape we
// rely on: top-level object keyed by absolute file path, each value
// carrying `s` (statementMap counters), `b` (branchMap counters), `f`
// (functionMap counters). For each file we report the percentage of
// covered counters (hit > 0).
export function aggregateCoverageFinal(json) {
  const rows = [];
  for (const [absPath, entry] of Object.entries(json)) {
    if (!entry || typeof entry !== 'object') continue;
    const { lines, branches, functions } = computeFilePercentages(entry);
    rows.push({ path: absPath, lines, branches, functions });
  }
  return rows;
}

function computeFilePercentages(entry) {
  // Statement coverage (Istanbul's `s` counters) approximates lines.
  const sCounts = Object.values(entry.s ?? {});
  const sTotal = sCounts.length;
  const sHit = sCounts.filter((c) => Number(c) > 0).length;
  const lines = sTotal === 0 ? 100 : (sHit / sTotal) * 100;

  // Branches: `b` is an object of arrays of counters per branch group.
  let bTotal = 0;
  let bHit = 0;
  for (const arr of Object.values(entry.b ?? {})) {
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      bTotal += 1;
      if (Number(c) > 0) bHit += 1;
    }
  }
  const branches = bTotal === 0 ? 100 : (bHit / bTotal) * 100;

  const fCounts = Object.values(entry.f ?? {});
  const fTotal = fCounts.length;
  const fHit = fCounts.filter((c) => Number(c) > 0).length;
  const functions = fTotal === 0 ? 100 : (fHit / fTotal) * 100;

  return {
    lines: round2(lines),
    branches: round2(branches),
    functions: round2(functions),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Roll a list of per-file rows up to the workspace level by averaging
// each axis weighted equally (per-file averaging). This matches the
// shape required by .agents/schemas/baselines/coverage.schema.json,
// where each rollup entry carries three numbers in [0, 100].
export function rollupRows(rows) {
  if (rows.length === 0) {
    return { lines: 0, branches: 0, functions: 0 };
  }
  const sum = rows.reduce(
    (acc, r) => ({
      lines: acc.lines + r.lines,
      branches: acc.branches + r.branches,
      functions: acc.functions + r.functions,
    }),
    { lines: 0, branches: 0, functions: 0 },
  );
  return {
    lines: round2(sum.lines / rows.length),
    branches: round2(sum.branches / rows.length),
    functions: round2(sum.functions / rows.length),
  };
}

// Build the envelope from a per-workspace map and a flat list of rows.
// `now` is injected for deterministic testing; production callers pass
// `new Date()`.
export function buildEnvelope({ workspaceRollups, rows }, now = new Date()) {
  const rollup = { '*': rollupRows(rows) };
  for (const ws of Object.keys(workspaceRollups).sort()) {
    rollup[ws] = workspaceRollups[ws];
  }
  const sortedRows = [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    $schema: SCHEMA_POINTER,
    kernelVersion: KERNEL_VERSION,
    generatedAt: now.toISOString(),
    rollup,
    rows: sortedRows,
  };
}

// ---------------------------------------------------------------------------
// Tolerance comparison (ADR-015 — absolute -2pp per workspace per axis)
// ---------------------------------------------------------------------------

// Returns an array of violations { workspace, axis, prev, current, deltaPp }
// for every (workspace, axis) pair where current dropped more than the
// tolerance below the prior baseline.
export function compareTolerance(prev, current, tolerancePp = TOLERANCE_PP) {
  if (harness?.compareWithTolerance) {
    return harness.compareWithTolerance(prev, current, {
      kind: 'absolute-pp',
      pp: tolerancePp,
    });
  }
  const violations = [];
  const prevRollup = prev?.rollup ?? {};
  const currRollup = current?.rollup ?? {};
  for (const ws of Object.keys(currRollup).sort()) {
    if (ws === '*') continue; // whole-repo rollup is informational; gate is per-workspace
    const prevAxes = prevRollup[ws];
    const currAxes = currRollup[ws];
    if (!prevAxes) {
      // New workspace registered — no prior to compare against. The
      // operator is expected to run --update to prime it. We do NOT
      // emit a violation here; the next --check after the first
      // --update will establish the floor.
      continue;
    }
    for (const axis of ['lines', 'branches', 'functions']) {
      const p = Number(prevAxes[axis] ?? 0);
      const c = Number(currAxes[axis] ?? 0);
      const deltaPp = c - p; // negative means coverage dropped
      if (deltaPp < -tolerancePp) {
        violations.push({
          workspace: ws,
          axis,
          prev: p,
          current: c,
          deltaPp: round2(deltaPp),
        });
      }
    }
  }
  return violations;
}

export function formatRejectionMessage(violations) {
  if (harness?.formatRejectionMessage) {
    return harness.formatRejectionMessage('coverage', violations);
  }
  const lines = ['[coverage-baseline] ❌ coverage regression detected (ADR-015 -2pp floor)'];
  for (const v of violations) {
    lines.push(
      `  ${v.workspace} ${v.axis}: ${v.prev.toFixed(2)}% → ${v.current.toFixed(2)}% (Δ=${
        v.deltaPp >= 0 ? '+' : ''
      }${v.deltaPp.toFixed(2)}pp)`,
    );
  }
  lines.push(
    '  Fix the regression, or — if the drop is intentional and approved — run `pnpm run coverage:update` to lower the floor.',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Serialise (sorted keys, trailing newline — diff-stable)
// ---------------------------------------------------------------------------

function sortedReplacer(_key, value) {
  // For plain objects, return a new object with sorted keys so
  // JSON.stringify emits keys in deterministic order. Arrays and
  // primitives pass through unchanged.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = value[k];
    }
    return sorted;
  }
  return value;
}

export function serialise(envelope) {
  return `${JSON.stringify(envelope, sortedReplacer, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function collectMeasurements({ coverageRoot, repoRoot = REPO_ROOT } = {}) {
  const workspaces = discoverWorkspaces(repoRoot);
  const workspaceRollups = {};
  const rows = [];
  for (const ws of workspaces) {
    const wsRoot = coverageRoot
      ? path.join(coverageRoot, ws, 'coverage', 'coverage-final.json')
      : workspaceCoverageFinal(ws, repoRoot);
    if (!wsRoot || !fs.existsSync(wsRoot)) {
      // No coverage output yet for this workspace — treat as zero
      // rollup. The operator must run `pnpm run test:coverage` before
      // priming the baseline.
      workspaceRollups[ws] = { lines: 0, branches: 0, functions: 0 };
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(wsRoot, 'utf8'));
    } catch (err) {
      throw new Error(`[coverage-baseline] failed to parse ${wsRoot}: ${err.message}`);
    }
    const wsRows = aggregateCoverageFinal(parsed);
    // Normalise paths to repo-relative POSIX for the envelope rows.
    for (const r of wsRows) {
      const rel = path.relative(repoRoot, r.path).split(path.sep).join('/');
      rows.push({ path: rel, lines: r.lines, branches: r.branches, functions: r.functions });
    }
    workspaceRollups[ws] = rollupRows(wsRows);
  }
  return { workspaceRollups, rows };
}

export function modeUpdate({ coverageRoot, repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const measurements = collectMeasurements({ coverageRoot, repoRoot });
  const envelope = buildEnvelope(measurements, now);
  writeBaseline(BASELINE_PATH, envelope);
  process.stdout.write(
    `[coverage-baseline] wrote baselines/coverage.json — workspaces=${
      Object.keys(measurements.workspaceRollups).length
    }, rows=${measurements.rows.length}\n`,
  );
  return 0;
}

export function modeCheck({ coverageRoot, repoRoot = REPO_ROOT, now = new Date() } = {}) {
  const baseline = readBaseline(BASELINE_PATH);
  if (!baseline) {
    process.stderr.write(
      '[coverage-baseline] baselines/coverage.json missing — run `pnpm run coverage:update` to prime it.\n',
    );
    return 1;
  }
  const measurements = collectMeasurements({ coverageRoot, repoRoot });
  const current = buildEnvelope(measurements, now);

  // Unprimed baseline (every rollup at 0) is treated as a green light —
  // the operator has not yet run --update, and we don't want to block
  // first PRs. The next --update establishes the real floor.
  const baselineIsUnprimed = Object.entries(baseline.rollup ?? {})
    .filter(([k]) => k !== '*')
    .every(([, v]) => v.lines === 0 && v.branches === 0 && v.functions === 0);
  if (baselineIsUnprimed) {
    process.stdout.write(
      '[coverage-baseline] baseline is unprimed (all workspace rollups are 0); skipping the -2pp gate. Run `pnpm run coverage:update` to establish the floor.\n',
    );
    return 0;
  }

  const violations = compareTolerance(baseline, current);
  if (violations.length === 0) {
    process.stdout.write(
      `[coverage-baseline] ok — ${Object.keys(measurements.workspaceRollups).length} workspace(s) within the -${TOLERANCE_PP}pp floor\n`,
    );
    return 0;
  }
  process.stderr.write(`${formatRejectionMessage(violations)}\n`);
  return 1;
}

function modeHelp() {
  process.stdout.write(
    `Usage: node scripts/coverage-baseline.mjs [--check | --update] [--coverage-root=<dir>]\n\n` +
      `  --check    (default) compare current coverage against baselines/coverage.json\n` +
      `             with a per-workspace -${TOLERANCE_PP}pp absolute floor (ADR-015)\n` +
      `  --update   regenerate baselines/coverage.json from the current tree\n` +
      `  --coverage-root=<dir>\n` +
      `             override the repo root used to locate per-workspace coverage-final.json\n` +
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
  const { mode, coverageRoot } = parseArgs(process.argv);
  let exitCode = 0;
  try {
    if (mode === 'update') exitCode = modeUpdate({ coverageRoot });
    else if (mode === 'check') exitCode = modeCheck({ coverageRoot });
    else exitCode = modeHelp();
  } catch (err) {
    process.stderr.write(`[coverage-baseline] ${err.message}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}
