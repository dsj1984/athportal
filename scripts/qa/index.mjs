#!/usr/bin/env node
// scripts/qa/index.mjs
//
// QA-corpus indexer. Walks every `tests/plans/**/*.plan.md` and
// `tests/charters/**/*.charter.md` artifact, parses its YAML
// front-matter, and emits a deterministic JSON catalog to
// `tests/qa-index.json`. Downstream consumers (`coverage:qa`, future
// reporters, dashboards) read the index instead of re-walking the
// corpus, so a single grep-friendly artifact captures the live state of
// the test plans and exploratory charters.
//
// Modes:
//   - default (`pnpm run index:qa`)
//       Regenerates `tests/qa-index.json` in place. Always exits 0.
//   - `--check` (`pnpm run index:qa -- --check`)
//       Regenerates the index in memory, diffs against the on-disk
//       file, and exits 1 if they differ. CI uses this mode to gate
//       drift between the corpus and the committed catalog.
//
// Index shape (Tech Spec #782 § Core Components → "scripts/qa/index.mjs"):
//   Array<{
//     id: string;                  // tp-... or ec-...
//     path: string;                // repo-relative POSIX path
//     type: 'plan' | 'charter';
//     domain: string;              // canonical domain enum entry
//     persona: string;             // canonical persona enum entry
//     surface?: string;            // plans only ('web' | 'mobile')
//     route_prefixes: string[];
//     mission?: string;            // charters only
//     time_box_minutes?: number;   // charters only
//     est_minutes?: number;        // plans only
//   }>
//
// The output is ordered lexically by `id` so the JSON diff is stable
// across platforms and across re-runs.
//
// Citation: Tech Spec #782 § Core Components #2 ("scripts/qa/index.mjs"),
// PRD #781 AC-4 / AC-8, Acceptance Spec #783 AC-6.

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PLANS_ROOT = path.join(REPO_ROOT, 'tests', 'plans');
const DEFAULT_CHARTERS_ROOT = path.join(REPO_ROOT, 'tests', 'charters');
const DEFAULT_INDEX_PATH = path.join(REPO_ROOT, 'tests', 'qa-index.json');
const HEURISTICS_DIRNAME = '_heuristics';

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Recursively collect every file matching `suffix` under `root`. Returns
 * absolute paths sorted for deterministic output across platforms
 * (Windows readdir order is not lexicographic by default).
 *
 * Skips the `_heuristics/` directory so heuristic reference cards are
 * not parsed as charters.
 */
async function discoverArtifacts(root, suffix) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === HEURISTICS_DIRNAME) continue;
      const nested = await discoverArtifacts(abs, suffix);
      out.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(abs);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Front-matter → index entry projection
// ---------------------------------------------------------------------------

/**
 * Convert an absolute path to a repo-relative POSIX path. The index is
 * grep-friendly only when the path separator is the same on every
 * platform, so we normalize Windows backslashes here rather than
 * forcing every consumer to do it.
 */
function toRepoRelative(absPath, repoRoot) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

/**
 * Project a parsed plan front-matter block into the index entry shape.
 * The function is total (returns either an entry or a structured error)
 * because the index runner aggregates errors instead of short-circuiting
 * on the first bad artifact.
 */
function projectPlanEntry(data, absPath, repoRoot) {
  const errors = [];
  const id = typeof data.id === 'string' ? data.id : null;
  if (id === null) errors.push('missing id');
  const domain = typeof data.domain === 'string' ? data.domain : null;
  if (domain === null) errors.push('missing domain');
  const persona = typeof data.persona === 'string' ? data.persona : null;
  if (persona === null) errors.push('missing persona');
  const surface = typeof data.surface === 'string' ? data.surface : null;
  if (surface === null) errors.push('missing surface');
  const routePrefixes = Array.isArray(data.route_prefixes) ? data.route_prefixes : null;
  if (routePrefixes === null) errors.push('missing route_prefixes');
  const estMinutes = typeof data.est_minutes === 'number' ? data.est_minutes : null;

  if (errors.length > 0) {
    return { ok: false, file: absPath, errors };
  }
  return {
    ok: true,
    entry: {
      id,
      path: toRepoRelative(absPath, repoRoot),
      type: 'plan',
      domain,
      persona,
      surface,
      route_prefixes: routePrefixes,
      ...(estMinutes !== null ? { est_minutes: estMinutes } : {}),
    },
  };
}

/**
 * Project a parsed charter front-matter block into the index entry shape.
 * Charters omit `surface` and `est_minutes` and add `mission` /
 * `time_box_minutes`.
 */
function projectCharterEntry(data, absPath, repoRoot) {
  const errors = [];
  const id = typeof data.id === 'string' ? data.id : null;
  if (id === null) errors.push('missing id');
  const domain = typeof data.domain === 'string' ? data.domain : null;
  if (domain === null) errors.push('missing domain');
  const persona = typeof data.persona === 'string' ? data.persona : null;
  if (persona === null) errors.push('missing persona');
  const routePrefixes = Array.isArray(data.route_prefixes) ? data.route_prefixes : null;
  if (routePrefixes === null) errors.push('missing route_prefixes');
  const mission = typeof data.mission === 'string' ? data.mission : null;
  const timeBoxMinutes = typeof data.time_box_minutes === 'number' ? data.time_box_minutes : null;

  if (errors.length > 0) {
    return { ok: false, file: absPath, errors };
  }
  return {
    ok: true,
    entry: {
      id,
      path: toRepoRelative(absPath, repoRoot),
      type: 'charter',
      domain,
      persona,
      route_prefixes: routePrefixes,
      ...(mission !== null ? { mission } : {}),
      ...(timeBoxMinutes !== null ? { time_box_minutes: timeBoxMinutes } : {}),
    },
  };
}

/**
 * Parse a single artifact and project it into an index entry. Returns a
 * `{ ok: true, entry }` discriminated union on success and a
 * `{ ok: false, file, errors }` shape on failure so the runner can
 * aggregate every problem before exiting.
 */
async function parseArtifact(absPath, kind, repoRoot) {
  let raw;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (err) {
    return { ok: false, file: absPath, errors: [`unreadable: ${err.message}`] };
  }

  let parsed;
  try {
    parsed = matter(raw);
  } catch (err) {
    return { ok: false, file: absPath, errors: [`unparseable YAML: ${err.message}`] };
  }

  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    return { ok: false, file: absPath, errors: ['missing or empty YAML front-matter'] };
  }

  if (kind === 'plan') {
    return projectPlanEntry(parsed.data, absPath, repoRoot);
  }
  return projectCharterEntry(parsed.data, absPath, repoRoot);
}

// ---------------------------------------------------------------------------
// Build the index
// ---------------------------------------------------------------------------

/**
 * Build the canonical index by walking the corpus. Returns
 * `{ entries, errors }`. `entries` is sorted by `id` (lexical).
 * `errors` is an array of `{ file, errors }` shapes for artifacts that
 * could not be projected.
 */
export async function buildIndex({
  plansRoot = DEFAULT_PLANS_ROOT,
  chartersRoot = DEFAULT_CHARTERS_ROOT,
  repoRoot = REPO_ROOT,
} = {}) {
  const planFiles = await discoverArtifacts(plansRoot, '.plan.md');
  const charterFiles = await discoverArtifacts(chartersRoot, '.charter.md');

  const entries = [];
  const errors = [];

  for (const file of planFiles) {
    let entryStat;
    try {
      entryStat = await stat(file);
    } catch {
      continue;
    }
    if (!entryStat.isFile()) continue;
    const result = await parseArtifact(file, 'plan', repoRoot);
    if (result.ok) {
      entries.push(result.entry);
    } else {
      errors.push({ file: result.file, errors: result.errors });
    }
  }

  for (const file of charterFiles) {
    let entryStat;
    try {
      entryStat = await stat(file);
    } catch {
      continue;
    }
    if (!entryStat.isFile()) continue;
    const result = await parseArtifact(file, 'charter', repoRoot);
    if (result.ok) {
      entries.push(result.entry);
    } else {
      errors.push({ file: result.file, errors: result.errors });
    }
  }

  // Lexical ordering by id so the JSON diff is stable across platforms.
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { entries, errors };
}

/**
 * Serialize the index to a canonical string. Two-space indent + trailing
 * newline matches the project's existing JSON-artifact conventions (see
 * `.lint-baseline.json`) and keeps the file diff-friendly.
 */
export function serializeIndex(entries) {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Read the on-disk index, or return null if the file is absent.
 */
async function readExistingIndex(indexPath) {
  try {
    return await readFile(indexPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Report aggregated parse errors to stderr in the same row-per-error
 * shape the lint script uses, so downstream tooling can grep both.
 */
function reportErrors(errors, repoRoot) {
  for (const err of errors) {
    const relFile = path.relative(repoRoot, err.file).split(path.sep).join('/');
    for (const message of err.errors) {
      process.stderr.write(`${relFile}: ${message}\n`);
    }
  }
}

/**
 * Main. Returns an exit code instead of calling `process.exit` so the
 * function is testable from unit tests.
 *
 * Options:
 *   - `plansRoot`     — override the plan discovery root (test fixtures)
 *   - `chartersRoot`  — override the charter discovery root (test fixtures)
 *   - `indexPath`     — override the on-disk index path
 *   - `repoRoot`      — repo root used to render relative `path` values
 *   - `check`         — when true, diff against the on-disk file and
 *                       exit 1 on mismatch instead of writing
 */
export async function runIndex({
  plansRoot = DEFAULT_PLANS_ROOT,
  chartersRoot = DEFAULT_CHARTERS_ROOT,
  indexPath = DEFAULT_INDEX_PATH,
  repoRoot = REPO_ROOT,
  check = false,
} = {}) {
  const { entries, errors } = await buildIndex({ plansRoot, chartersRoot, repoRoot });

  if (errors.length > 0) {
    reportErrors(errors, repoRoot);
    process.stderr.write(
      `index:qa: FAIL — ${errors.length} artifact(s) could not be projected into the index\n`,
    );
    return 1;
  }

  const next = serializeIndex(entries);

  if (check) {
    const current = await readExistingIndex(indexPath);
    if (current === null) {
      const relIndex = path.relative(repoRoot, indexPath).split(path.sep).join('/');
      process.stderr.write(
        `index:qa: FAIL — ${relIndex} is missing; run \`pnpm run index:qa\` to generate it\n`,
      );
      return 1;
    }
    if (current !== next) {
      const relIndex = path.relative(repoRoot, indexPath).split(path.sep).join('/');
      process.stderr.write(
        `index:qa: FAIL — ${relIndex} is out of sync with the corpus; run \`pnpm run index:qa\` to regenerate it\n`,
      );
      return 1;
    }
    process.stdout.write(`index:qa: ok — ${entries.length} artifact(s) indexed (check mode)\n`);
    return 0;
  }

  await writeFile(indexPath, next, 'utf8');
  process.stdout.write(`index:qa: ok — ${entries.length} artifact(s) indexed\n`);
  return 0;
}

// Exported for unit tests.
export { discoverArtifacts, parseArtifact, projectPlanEntry, projectCharterEntry, toRepoRelative };

// Only run when invoked directly (not when imported by tests). The
// resolved CLI argv may be undefined when the module is imported via
// `node -e "import(...)"`, so guard the comparison defensively.
const invokedAs = process.argv[1] ?? '';
const isDirectCli =
  invokedAs.length > 0 && fileURLToPath(import.meta.url) === path.resolve(invokedAs);
if (isDirectCli) {
  const check = process.argv.includes('--check');
  const code = await runIndex({ check });
  process.exit(code);
}
