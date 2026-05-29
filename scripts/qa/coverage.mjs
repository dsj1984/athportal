#!/usr/bin/env node
// scripts/qa/coverage.mjs
//
// QA-corpus coverage reporter. Reads `tests/qa-index.json` (produced by
// `scripts/qa/index.mjs`), counts charters per domain, and reports the
// gap against the per-domain floors declared in
// `scripts/qa/schema/coverage-floors.ts`.
//
// Scripted Test Plans (`tests/plans/**`) were retired from the corpus,
// so charters are the only artifact kind the index now carries and the
// only kind this reporter measures.
//
// Modes:
//   - default (`pnpm run coverage:qa`)
//       Prints a human-readable domain × charter grid to stdout and
//       exits 0 regardless of gaps. Useful as a status snapshot while
//       authoring.
//   - `--report` (`pnpm run coverage:qa -- --report`)
//       Writes a structured report to `coverage/qa-coverage.json` and
//       exits 1 when at least one floor is unmet. CI uses this mode to
//       gate the floor invariants.
//
// Report shape (Tech Spec #782 § Core Components → "scripts/qa/coverage.mjs"):
//   {
//     floors: Record<Domain, { charters: number }>,
//     actual: Record<Domain, { charters: number }>,
//     gaps: Array<{
//       domain: Domain;
//       kind: 'charter';
//       need: number;
//       have: number;
//     }>,
//   }
//
// Citation: Tech Spec #782 § Core Components #3 ("scripts/qa/coverage.mjs"),
// PRD #781 AC-7 / AC-8, Acceptance Spec #783 AC-14 / AC-15.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { COVERAGE_FLOORS, DOMAINS } from './schema/coverage-floors.ts';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_INDEX_PATH = path.join(REPO_ROOT, 'tests', 'qa-index.json');
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'coverage', 'qa-coverage.json');

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/**
 * Initialize an empty `Record<Domain, { charters }>` populated with
 * zeros for every declared domain so the output is exhaustive even
 * when a domain has no live artifacts yet.
 */
function emptyTotals() {
  const totals = {};
  for (const domain of DOMAINS) {
    totals[domain] = { charters: 0 };
  }
  return totals;
}

/**
 * Count charters per domain across the given index entries. Returns the
 * populated totals object. Entries whose `domain` is not in the declared
 * enum are skipped — those would have failed the lint stage before ever
 * reaching the index.
 */
export function countByDomain(entries) {
  const totals = emptyTotals();
  for (const entry of entries) {
    const domain = entry.domain;
    if (!(domain in totals)) continue;
    if (entry.type === 'charter') totals[domain].charters += 1;
  }
  return totals;
}

/**
 * Compute the gaps between actual counts and the declared floors.
 * Returns an array of `{ domain, kind, need, have }` records, sorted
 * by `domain` so the JSON diff is stable across runs.
 */
export function computeGaps(actual, floors) {
  const gaps = [];
  for (const domain of DOMAINS) {
    const floor = floors[domain];
    const got = actual[domain];
    if (got.charters < floor.charters) {
      gaps.push({ domain, kind: 'charter', need: floor.charters, have: got.charters });
    }
  }
  return gaps;
}

// ---------------------------------------------------------------------------
// Index loading
// ---------------------------------------------------------------------------

/**
 * Read the on-disk index. Returns the parsed array of entries. Throws
 * with a clear message when the file is missing or unparseable so the
 * CLI surfaces an actionable error rather than a stack trace.
 */
export async function loadIndex(indexPath) {
  let raw;
  try {
    raw = await readFile(indexPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `coverage:qa: tests/qa-index.json not found at ${indexPath} — run \`pnpm run index:qa\` first`,
      );
    }
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`coverage:qa: unparseable JSON at ${indexPath}: ${err.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`coverage:qa: expected an array at ${indexPath}, got ${typeof parsed}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Human-readable rendering
// ---------------------------------------------------------------------------

/**
 * Render the per-domain grid as a fixed-width table to stdout. Each row
 * shows the domain, the charters floor / actual / gap. The renderer is
 * deterministic and column-padded so the output is comfortable to scan
 * in CI logs.
 */
export function renderGrid({ floors, actual, gaps }) {
  const gapKeys = new Set(gaps.map((g) => `${g.domain}:${g.kind}`));
  const rows = [];
  rows.push(['domain', 'charters (have/need)', 'status']);
  for (const domain of DOMAINS) {
    const charterStr = `${actual[domain].charters}/${floors[domain].charters}`;
    const charterGap = gapKeys.has(`${domain}:charter`);
    const status = charterGap ? 'GAP (charters)' : 'ok';
    rows.push([domain, charterStr, status]);
  }
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => r[col].length)));
  const lines = rows.map((row) => row.map((cell, col) => cell.padEnd(widths[col], ' ')).join('  '));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * Build the report object from a freshly-loaded index. The shape is
 * documented at the top of this file. `floors` is cloned so callers can
 * mutate the returned object without scribbling on the SSOT.
 */
export function buildReport(entries, { floors = COVERAGE_FLOORS } = {}) {
  const actual = countByDomain(entries);
  const gaps = computeGaps(actual, floors);
  // Clone the floors record so the report is fully owned by the caller.
  const floorsCopy = {};
  for (const domain of DOMAINS) {
    floorsCopy[domain] = { charters: floors[domain].charters };
  }
  return { floors: floorsCopy, actual, gaps };
}

/**
 * Serialize the report with the same `JSON.stringify(_, null, 2)` +
 * trailing newline shape the index uses, so both files diff cleanly.
 */
export function serializeReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Main. Returns an exit code instead of calling `process.exit` so the
 * function is testable from unit tests.
 *
 * Options:
 *   - `indexPath`   — override the index path (test fixtures)
 *   - `reportPath`  — override the report path (test fixtures)
 *   - `report`      — when true, write `coverage/qa-coverage.json` and
 *                     exit 1 on non-empty gaps
 *   - `floors`      — inject a floors table (test fixtures)
 */
export async function runCoverage({
  indexPath = DEFAULT_INDEX_PATH,
  reportPath = DEFAULT_REPORT_PATH,
  report = false,
  floors = COVERAGE_FLOORS,
} = {}) {
  const entries = await loadIndex(indexPath);
  const built = buildReport(entries, { floors });

  // Always print the grid — it is the operator-facing snapshot regardless
  // of mode. Stderr would be more discoverable on failure, but stdout
  // makes it easy to capture for dashboards.
  process.stdout.write(`${renderGrid(built)}\n`);

  if (report) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, serializeReport(built), 'utf8');
    if (built.gaps.length > 0) {
      process.stderr.write(
        `coverage:qa: FAIL — ${built.gaps.length} domain floor(s) unmet (see coverage/qa-coverage.json)\n`,
      );
      return 1;
    }
    process.stdout.write('coverage:qa: ok — every domain meets its declared floor (report mode)\n');
    return 0;
  }

  if (built.gaps.length > 0) {
    process.stdout.write(
      `coverage:qa: note — ${built.gaps.length} floor gap(s); run with --report to fail CI\n`,
    );
  } else {
    process.stdout.write('coverage:qa: ok — every domain meets its declared floor\n');
  }
  return 0;
}

// Only run when invoked directly (not when imported by tests). The
// resolved CLI argv may be undefined when the module is imported via
// `node -e "import(...)"`, so guard the comparison defensively.
const invokedAs = process.argv[1] ?? '';
const isDirectCli =
  invokedAs.length > 0 && fileURLToPath(import.meta.url) === path.resolve(invokedAs);
if (isDirectCli) {
  const report = process.argv.includes('--report');
  const code = await runCoverage({ report });
  process.exit(code);
}
