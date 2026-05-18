#!/usr/bin/env node
// scripts/mutation-baseline.mjs
//
// Mutation-baseline dimension for the athportal monorepo (Story #208,
// Epic #6 — Quality Baselines). Wraps Stryker's JSON report into the
// shared baseline-envelope contract at
// `.agents/schemas/baselines/mutation.schema.json` and gates per-
// workspace mutation score with a 5% relative tolerance (higher-is-
// better polarity).
//
//   --check    (default) read baselines/mutation.json + Stryker's JSON
//              report, compare per-workspace `score` rollups with a
//              `relative-pct: 5` tolerance, exit non-zero when any
//              workspace regresses past the band. Refuses to run when
//              the Stryker report is missing (operator must run
//              `pnpm run mutation` first).
//   --update   re-derive baselines/mutation.json from the current
//              Stryker report. Same byte-identical re-emission contract
//              as every other dimension — the harness `writeBaseline`
//              checks this before the file touches disk.
//
// Wiring: consumed by the nightly-only `mutation-baseline` job under
// .github/workflows/nightly.yml. NOT wired into quality.yml (PR CI) —
// mutation runs take ~10 minutes and are scheduled, not interactive.
// See PRD #195 § Non-goals.
//
// Security baseline (`.agents/rules/security-baseline.md`): no PII in
// fixtures; no user-provided input reaches a shell; report path is
// resolved relative to repo root with `path.resolve` and never built
// from untrusted templating.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The shared harness is imported lazily inside `modeCheck` / `modeUpdate`
// so the pure helpers below (parseArgs, buildEnvelope, aggregateReport,
// rollupRowsByWorkspace, …) remain unit-testable without the
// `@repo/baselines` package being resolvable on disk. The lighthouse
// dimension uses the same pattern.
async function loadHarness() {
  return import('@repo/baselines');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const BASELINE_PATH = path.join(REPO_ROOT, 'baselines', 'mutation.json');
export const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'reports', 'mutation', 'mutation.json');
export const SCHEMA_POINTER = '.agents/schemas/baselines/mutation.schema.json';
export const KERNEL_VERSION = '1.0.0';
// Story #208 AC: 5% relative tolerance per workspace.
export const TOLERANCE_PCT = 5;

// Mutant statuses that count as a successful kill (the test suite
// surfaced the mutant). `Killed`, `Timeout`, and `RuntimeError` all
// register as caught by the suite. `Survived` and `NoCoverage` count
// against the score. `Ignored` and `CompileError` are excluded from
// both numerator and denominator per Stryker's documented convention.
const KILLED_STATUSES = new Set(['Killed', 'Timeout', 'RuntimeError']);
const SURVIVED_STATUSES = new Set(['Survived']);
const NO_COVERAGE_STATUSES = new Set(['NoCoverage']);

// ---------------------------------------------------------------------------
// CLI argv parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  let mode = 'check';
  let reportPath = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') mode = 'check';
    else if (a === '--update') mode = 'update';
    else if (a === '--help' || a === '-h') mode = 'help';
    else if (a === '--report-path' || a.startsWith('--report-path=')) {
      reportPath = a.includes('=') ? a.slice('--report-path='.length) : argv[++i];
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { mode, reportPath };
}

// ---------------------------------------------------------------------------
// Stryker report aggregation
// ---------------------------------------------------------------------------

// Stryker's mutation-testing-report-schema JSON puts everything under a
// top-level `files` object keyed by source path (relative to the
// schema's `projectRoot`). Each file carries `mutants: [{ status, ... }]`.
// We aggregate per-file killed/survived/noCoverage counts and derive the
// per-file score from the same formula Stryker prints in clear-text.
//
//   score = (killed + timeout + runtimeError) /
//           (killed + timeout + runtimeError + survived + noCoverage)
//
// When the denominator is 0 (every mutant ignored or compile-errored)
// the per-file score is reported as 100 — there is nothing to fault
// the suite on, so the row is informational.
export function aggregateReport(report) {
  if (!report || typeof report !== 'object' || !report.files) {
    return { rows: [] };
  }
  const rows = [];
  for (const [filePath, entry] of Object.entries(report.files)) {
    if (!entry || !Array.isArray(entry.mutants)) continue;
    const counts = countMutants(entry.mutants);
    rows.push({
      path: normalisePath(filePath),
      score: computeScore(counts),
      killed: counts.killed,
      survived: counts.survived,
      // noCoverage is intentionally elided from the per-row shape (the
      // per-kind schema names only path/score/killed/survived on rows)
      // — it rolls up into the workspace and `*` envelopes instead.
      _noCoverage: counts.noCoverage,
    });
  }
  return { rows };
}

function countMutants(mutants) {
  let killed = 0;
  let survived = 0;
  let noCoverage = 0;
  for (const m of mutants) {
    const status = m?.status;
    if (KILLED_STATUSES.has(status)) killed += 1;
    else if (SURVIVED_STATUSES.has(status)) survived += 1;
    else if (NO_COVERAGE_STATUSES.has(status)) noCoverage += 1;
  }
  return { killed, survived, noCoverage };
}

export function computeScore({ killed, survived, noCoverage }) {
  const denom = killed + survived + noCoverage;
  if (denom === 0) return 100;
  const score = (killed / denom) * 100;
  return round2(score);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normalisePath(p) {
  return p.split(/[\\/]/).join('/');
}

// ---------------------------------------------------------------------------
// Workspace discovery + per-workspace rollup
// ---------------------------------------------------------------------------

// Returns the list of workspace directories declared via pnpm-workspace.yaml
// (apps/* and packages/*), resolved against the supplied repo root and
// sorted lex. Mirrors scripts/coverage-baseline.mjs § discoverWorkspaces.
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

// Given a flat list of per-file rows, group them by workspace (any path
// starting `apps/<name>/` or `packages/<name>/`) and roll up the
// killed/survived/noCoverage counts. The per-workspace `score` is
// derived from the rolled-up counts (not from averaging row scores) so
// large files do not get equal weight to tiny ones.
export function rollupRowsByWorkspace(rows, workspaces = []) {
  const acc = Object.fromEntries(
    workspaces.map((ws) => [ws, { killed: 0, survived: 0, noCoverage: 0 }]),
  );
  for (const row of rows) {
    const ws = workspaceForPath(row.path);
    if (!ws) continue;
    if (!acc[ws]) acc[ws] = { killed: 0, survived: 0, noCoverage: 0 };
    acc[ws].killed += row.killed;
    acc[ws].survived += row.survived;
    acc[ws].noCoverage += row._noCoverage ?? 0;
  }
  const rollup = {};
  for (const ws of Object.keys(acc).sort()) {
    const c = acc[ws];
    rollup[ws] = {
      score: computeScore(c),
      killed: c.killed,
      survived: c.survived,
      noCoverage: c.noCoverage,
    };
  }
  return rollup;
}

function workspaceForPath(p) {
  const parts = p.split('/');
  if (parts.length < 2) return null;
  if (parts[0] !== 'apps' && parts[0] !== 'packages') return null;
  return `${parts[0]}/${parts[1]}`;
}

// Compute the whole-repo `*` rollup by re-aggregating every row's
// counts (so files outside any workspace still contribute).
export function rollupAll(rows) {
  const c = { killed: 0, survived: 0, noCoverage: 0 };
  for (const row of rows) {
    c.killed += row.killed;
    c.survived += row.survived;
    c.noCoverage += row._noCoverage ?? 0;
  }
  return {
    score: computeScore(c),
    killed: c.killed,
    survived: c.survived,
    noCoverage: c.noCoverage,
  };
}

// ---------------------------------------------------------------------------
// Envelope construction
// ---------------------------------------------------------------------------

export function buildEnvelope({ rows, workspaces }, now = new Date()) {
  const sortedRows = [...rows]
    .map((r) => ({ path: r.path, score: r.score, killed: r.killed, survived: r.survived }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const rollup = { '*': rollupAll(rows) };
  const wsRollup = rollupRowsByWorkspace(rows, workspaces);
  for (const ws of Object.keys(wsRollup).sort()) {
    rollup[ws] = wsRollup[ws];
  }
  return {
    $schema: SCHEMA_POINTER,
    kernelVersion: KERNEL_VERSION,
    generatedAt: now.toISOString(),
    rollup,
    rows: sortedRows,
  };
}

// ---------------------------------------------------------------------------
// Per-workspace tolerance gate (5% relative on `score`)
// ---------------------------------------------------------------------------
//
// Story #208 AC: a synthetic -6% drop on one workspace's score must
// produce a violation. The harness's `relative-pct` evaluator handles
// the math; we iterate the per-workspace rollup explicitly so the
// rejection message names the workspace, not a row.
export function compareWorkspaceRollups(prev, current, harness, tolerancePct = TOLERANCE_PCT) {
  const violations = [];
  const tolerance = { kind: 'relative-pct', pct: tolerancePct };
  const prevRollup = prev?.rollup ?? {};
  const currRollup = current?.rollup ?? {};
  for (const ws of Object.keys(currRollup).sort()) {
    if (ws === '*') continue;
    const prevAxes = prevRollup[ws];
    const currAxes = currRollup[ws];
    if (!prevAxes) continue; // new workspace — first run primes the floor
    const violation = harness.evaluate(
      tolerance,
      prevAxes.score,
      currAxes.score,
      'higher-is-better',
    );
    if (violation) {
      violations.push({
        workspace: ws,
        axis: 'score',
        prev: prevAxes.score,
        current: currAxes.score,
        tolerance,
        severity: violation,
      });
    }
  }
  return violations;
}

export function formatWorkspaceViolations(violations) {
  if (violations.length === 0) return '';
  const lines = [
    `[mutation-baseline] x mutation regression detected (per-workspace relative-pct(${TOLERANCE_PCT}%))`,
  ];
  for (const v of violations) {
    const delta = round2(v.current - v.prev);
    const pct = v.prev === 0 ? 0 : round2(((v.current - v.prev) / v.prev) * 100);
    lines.push(
      `  ${v.workspace} ${v.axis}: ${v.prev.toFixed(2)}% -> ${v.current.toFixed(2)}% (delta=${delta >= 0 ? '+' : ''}${delta.toFixed(2)}, ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
    );
  }
  lines.push(
    '  Fix the regression, or - if the drop is intentional and approved - run `pnpm run mutation:update` to lower the floor.',
  );
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Stryker report IO
// ---------------------------------------------------------------------------

export function loadReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `mutation-baseline: Stryker JSON report not found at ${path.relative(REPO_ROOT, reportPath) || reportPath}. Run \`pnpm run mutation\` first (the json reporter writes to reports/mutation/mutation.json).`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (err) {
    throw new Error(`mutation-baseline: failed to parse ${reportPath}: ${err.message}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function measure({ reportPath, repoRoot = REPO_ROOT } = {}) {
  const resolvedReportPath = reportPath ? path.resolve(repoRoot, reportPath) : DEFAULT_REPORT_PATH;
  const report = loadReport(resolvedReportPath);
  const { rows } = aggregateReport(report);
  const workspaces = discoverWorkspaces(repoRoot);
  return { rows, workspaces };
}

async function modeUpdate({ reportPath }) {
  const { writeBaseline } = await loadHarness();
  const measurements = measure({ reportPath });
  const envelope = buildEnvelope(measurements);
  writeBaseline(BASELINE_PATH, envelope, 'mutation');
  process.stdout.write(
    `[mutation-baseline] wrote baselines/mutation.json - workspaces=${
      Object.keys(envelope.rollup).length - 1
    }, rows=${envelope.rows.length}\n`,
  );
  return 0;
}

async function modeCheck({ reportPath }) {
  // Detect the unprimed envelope without loading the harness so the
  // skip-path stays operational while `@repo/baselines` still ships
  // TypeScript-only exports (Story #210 ships the built harness).
  if (!fs.existsSync(BASELINE_PATH)) {
    process.stderr.write(
      `[mutation-baseline] baseline file missing at ${path.relative(REPO_ROOT, BASELINE_PATH)}\n`,
    );
    return 1;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  // Unprimed = no per-workspace rollups, or every per-workspace rollup
  // at score 0. Empty rollup ships as the initial committed envelope so
  // the floor isn't set before the first real Stryker run lands.
  const workspaceRollupEntries = Object.entries(baseline.rollup ?? {}).filter(([k]) => k !== '*');
  const baselineIsUnprimed =
    workspaceRollupEntries.length === 0 ||
    workspaceRollupEntries.every(([, v]) => Number(v?.score ?? 0) === 0);
  if (baselineIsUnprimed) {
    process.stdout.write(
      '[mutation-baseline] baseline is unprimed (no per-workspace rollups). Skipping the 5% tolerance gate. Run `pnpm run mutation:update` after a successful `pnpm run mutation` to establish the floor.\n',
    );
    return 0;
  }

  const harness = await loadHarness();
  const measurements = measure({ reportPath });
  const current = buildEnvelope(measurements);
  const violations = compareWorkspaceRollups(baseline, current, harness);
  if (violations.length === 0) {
    const wsCount = Object.keys(current.rollup).filter((k) => k !== '*').length;
    process.stdout.write(
      `[mutation-baseline] ok - ${wsCount} workspace(s) within the ${TOLERANCE_PCT}% relative band\n`,
    );
    return 0;
  }
  process.stderr.write(formatWorkspaceViolations(violations));
  return 1;
}

function modeHelp() {
  process.stdout.write(
    `Usage: node scripts/mutation-baseline.mjs [--check | --update] [--report-path=<path>]\n\n` +
      `  --check         (default) compare current Stryker report against baselines/mutation.json\n` +
      `                  with a per-workspace ${TOLERANCE_PCT}% relative-pct floor on mutation score\n` +
      `  --update        regenerate baselines/mutation.json from the current Stryker report\n` +
      `  --report-path   path to Stryker JSON report (default: reports/mutation/mutation.json)\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  let exitCode = 0;
  try {
    const args = parseArgs(process.argv);
    if (args.mode === 'update') exitCode = await modeUpdate(args);
    else if (args.mode === 'check') exitCode = await modeCheck(args);
    else exitCode = modeHelp();
  } catch (err) {
    process.stderr.write(`[mutation-baseline] ${err.message}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}
