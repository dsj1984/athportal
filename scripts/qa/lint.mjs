#!/usr/bin/env node
// scripts/qa/lint.mjs
//
// QA-corpus linter. Scans every `tests/plans/**/*.plan.md` and
// `tests/charters/**/*.charter.md` artifact, validates its YAML
// front-matter against the matching Zod schema in `scripts/qa/schema/`,
// and verifies the required body sections.
//
// The dispatcher reads `type:` from front-matter and routes:
//   - `type: plan`    → plan.front-matter.zod.ts + Setup/Steps/Cleanup body
//   - `type: charter` → charter.front-matter.zod.ts + Mission/Heuristics/
//                       Findings body + heuristic-name resolution against
//                       tests/charters/_heuristics/<name>.md
//
// Wired into:
//   - `pnpm run lint:qa` (package.json scripts) — CI quality gate
//   - Husky `pre-commit` step that also runs `lint:qa` against staged
//     `.plan.md` / `.charter.md` paths (added by a later Story)
//
// Exit codes:
//   0 — every artifact parsed and body-shape-checked clean
//   1 — at least one artifact failed schema or body validation
//   2 — CLI usage error (unreadable paths, malformed args)
//
// Output contract:
//   - Success path prints a one-line summary to stdout:
//       "lint:qa: ok — N plan(s), M charter(s) checked"
//   - Each error prints a per-file row to stderr:
//       "<file>: <field-path-or-section>: <message>"
//     Multiple errors per file are listed individually so the operator
//     sees every issue at once (no first-fail short-circuit).
//
// Citation: Tech Spec #782 § Core Components → "scripts/qa/lint.mjs".

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

import { safeParseCharterFrontMatter } from './schema/charter.front-matter.zod.ts';
import { safeParsePlanFrontMatter } from './schema/plan.front-matter.zod.ts';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PLANS_ROOT = path.join(REPO_ROOT, 'tests', 'plans');
const DEFAULT_CHARTERS_ROOT = path.join(REPO_ROOT, 'tests', 'charters');
const HEURISTICS_DIRNAME = '_heuristics';

// ---------------------------------------------------------------------------
// Body-shape rules
// ---------------------------------------------------------------------------

/**
 * Required H2 sections for a plan, in order. The order is part of the
 * canonical body shape per Tech Spec #782 § Body shape → "Plan".
 */
const REQUIRED_PLAN_SECTIONS = ['## Setup', '## Steps', '## Cleanup'];

/**
 * Required H2 sections for a charter, in order. Per Tech Spec #782
 * § Body shape → "Charter". `## Notes` is optional per the spec body
 * (free-form scratchpad) and is not required.
 */
const REQUIRED_CHARTER_SECTIONS = ['## Mission', '## Heuristics', '## Findings'];

/**
 * Each numbered step in a plan must be followed by an `**Expected:**`
 * line. The pattern is intentionally permissive about whitespace so
 * authors can format the expected line on the same physical line or on
 * the next indented line.
 */
const STEP_HEADER_PATTERN = /^\s*(\d+)\.\s+/m;
const EXPECTED_LINE_PATTERN = /\*\*Expected:\*\*/;

// ---------------------------------------------------------------------------
// Recursive file discovery
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

async function discoverPlanFiles(root) {
  return discoverArtifacts(root, '.plan.md');
}

async function discoverCharterFiles(root) {
  return discoverArtifacts(root, '.charter.md');
}

/**
 * Build the set of known heuristic names by listing the
 * `tests/charters/_heuristics/` directory. Each `.md` file's basename
 * (without extension) is a registered heuristic name.
 */
async function loadHeuristicNames(chartersRoot) {
  const heuristicsDir = path.join(chartersRoot, HEURISTICS_DIRNAME);
  let entries;
  try {
    entries = await readdir(heuristicsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return new Set();
    throw err;
  }
  const names = new Set();
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      names.add(entry.name.replace(/\.md$/, ''));
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Render a Zod error path as a dotted/bracketed string suitable for the
 * per-line error column. `[]` keeps array indices grep-able.
 */
function formatPath(zodPath) {
  if (zodPath.length === 0) return '<root>';
  return zodPath
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : segment))
    .join('.');
}

/**
 * Search for required H2 sections inside `body`. Line-by-line scan so a
 * `## Heading` reference inside a code block does not satisfy the rule.
 */
function findMissingSections(body, required) {
  const lines = body.split(/\r?\n/);
  const sectionLines = new Set(lines.map((line) => line.trim()));
  const errors = [];
  for (const section of required) {
    if (!sectionLines.has(section)) {
      errors.push({
        section: section.replace('## ', ''),
        message: `missing required section "${section}"`,
      });
    }
  }
  return errors;
}

/**
 * Validate the body of a plan. Returns an array of `{ section, message }`
 * errors so the caller can render them per-file.
 */
function validatePlanBody(body) {
  const errors = findMissingSections(body, REQUIRED_PLAN_SECTIONS);

  // If `## Steps` is present, every numbered step must be followed by an
  // `**Expected:**` line within the same step block. We segment the
  // Steps section between `## Steps` and the next H2 header.
  const lines = body.split(/\r?\n/);
  const stepsStart = lines.findIndex((line) => line.trim() === '## Steps');
  if (stepsStart >= 0) {
    let stepsEnd = lines.findIndex((line, idx) => idx > stepsStart && /^##\s+/.test(line));
    if (stepsEnd === -1) stepsEnd = lines.length;
    const stepsBlock = lines.slice(stepsStart + 1, stepsEnd).join('\n');

    // Split on numbered step headers; the first piece (before step 1) is
    // narrative/preamble and can be skipped.
    const stepBlocks = stepsBlock.split(STEP_HEADER_PATTERN);
    // After split, stepBlocks alternates: [preamble, "1", block1, "2", block2, ...]
    for (let i = 1; i < stepBlocks.length; i += 2) {
      const stepNumber = stepBlocks[i];
      const stepBody = stepBlocks[i + 1] ?? '';
      if (!EXPECTED_LINE_PATTERN.test(stepBody)) {
        errors.push({
          section: 'Steps',
          message: `step ${stepNumber} is missing an "**Expected:**" line`,
        });
      }
    }
  }

  return errors;
}

/**
 * Validate the body of a charter. Returns an array of `{ section,
 * message }` errors. The charter body must carry `## Mission`,
 * `## Heuristics`, and `## Findings` headings; `## Notes` is optional.
 */
function validateCharterBody(body) {
  return findMissingSections(body, REQUIRED_CHARTER_SECTIONS);
}

/**
 * Resolve the heuristic names referenced in a charter's front-matter
 * against the registered set. Returns an array of `{ name, message }`
 * for every unknown name.
 */
function validateCharterHeuristics(heuristicNames, knownHeuristics) {
  const errors = [];
  for (const name of heuristicNames) {
    if (!knownHeuristics.has(name)) {
      errors.push({
        name,
        message: `heuristic "${name}" does not resolve to tests/charters/_heuristics/${name}.md`,
      });
    }
  }
  return errors;
}

/**
 * Validate a single plan file. Returns an array of `{ file, field,
 * message }` errors; an empty array means the file is clean.
 */
async function validatePlanFile(absPath) {
  const errors = [];
  let raw;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (err) {
    return [{ file: absPath, field: '<io>', message: `unreadable: ${err.message}` }];
  }

  let parsed;
  try {
    parsed = matter(raw);
  } catch (err) {
    return [
      { file: absPath, field: '<front-matter>', message: `unparseable YAML: ${err.message}` },
    ];
  }

  // Empty front-matter is a hard failure — the schema would reject every
  // required field, but a clearer single message is friendlier.
  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    return [
      { file: absPath, field: '<front-matter>', message: 'missing or empty YAML front-matter' },
    ];
  }

  // A `.plan.md` whose front-matter type is anything but `plan` is a
  // type/path mismatch — surface it as a single clear error rather than
  // letting the plan schema reject every other field.
  if (parsed.data.type !== undefined && parsed.data.type !== 'plan') {
    return [
      {
        file: absPath,
        field: 'type',
        message: `file extension .plan.md requires type: "plan" (received "${parsed.data.type}")`,
      },
    ];
  }

  // Plan schema validation
  const result = safeParsePlanFrontMatter(parsed.data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        file: absPath,
        field: formatPath(issue.path),
        message: issue.message,
      });
    }
    // Body validation only runs once the schema is well-formed enough
    // to trust `type: plan`. We still surface body errors when the
    // schema fails, so authors see every issue at once.
  }

  const bodyErrors = validatePlanBody(parsed.content);
  for (const bodyError of bodyErrors) {
    errors.push({
      file: absPath,
      field: bodyError.section,
      message: bodyError.message,
    });
  }

  return errors;
}

/**
 * Validate a single charter file. Returns an array of `{ file, field,
 * message }` errors; an empty array means the file is clean.
 *
 * `knownHeuristics` is the Set of registered heuristic names; used to
 * resolve every name listed in charter front-matter against the
 * `_heuristics/` directory.
 */
async function validateCharterFile(absPath, knownHeuristics) {
  const errors = [];
  let raw;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (err) {
    return [{ file: absPath, field: '<io>', message: `unreadable: ${err.message}` }];
  }

  let parsed;
  try {
    parsed = matter(raw);
  } catch (err) {
    return [
      { file: absPath, field: '<front-matter>', message: `unparseable YAML: ${err.message}` },
    ];
  }

  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    return [
      { file: absPath, field: '<front-matter>', message: 'missing or empty YAML front-matter' },
    ];
  }

  // A `.charter.md` whose front-matter type is anything but `charter`
  // is a type/path mismatch — surface it clearly.
  if (parsed.data.type !== undefined && parsed.data.type !== 'charter') {
    return [
      {
        file: absPath,
        field: 'type',
        message: `file extension .charter.md requires type: "charter" (received "${parsed.data.type}")`,
      },
    ];
  }

  const result = safeParseCharterFrontMatter(parsed.data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        file: absPath,
        field: formatPath(issue.path),
        message: issue.message,
      });
    }
  }

  const bodyErrors = validateCharterBody(parsed.content);
  for (const bodyError of bodyErrors) {
    errors.push({
      file: absPath,
      field: bodyError.section,
      message: bodyError.message,
    });
  }

  // Heuristic-name resolution only runs once the front-matter parsed
  // (otherwise `heuristics` may not exist or may not be an array). Even
  // when the schema fails, we attempt to resolve any names that *did*
  // come through as a string[] so authors see every issue at once.
  const heuristicCandidate = parsed.data.heuristics;
  if (Array.isArray(heuristicCandidate)) {
    const heuristicErrors = validateCharterHeuristics(heuristicCandidate, knownHeuristics);
    for (const herr of heuristicErrors) {
      errors.push({
        file: absPath,
        field: 'heuristics',
        message: herr.message,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Render errors to stderr. One row per error so grep + editor jump-to-line
 * tooling works.
 */
function reportErrors(errors) {
  for (const err of errors) {
    const relFile = path.relative(REPO_ROOT, err.file).split(path.sep).join('/');
    process.stderr.write(`${relFile}: ${err.field}: ${err.message}\n`);
  }
}

/**
 * Main. Returns an exit code instead of calling `process.exit` so the
 * function is testable from unit tests.
 *
 * Options:
 *   - `plansRoot`     — override the plan discovery root (test fixtures)
 *   - `chartersRoot`  — override the charter discovery root (test fixtures)
 *   - `paths`         — when provided, validate exactly this list of file
 *                       paths instead of recursive discovery; each path is
 *                       dispatched on its suffix (`.plan.md` vs `.charter.md`).
 */
export async function runLint({
  plansRoot = DEFAULT_PLANS_ROOT,
  chartersRoot = DEFAULT_CHARTERS_ROOT,
  paths = null,
} = {}) {
  const knownHeuristics = await loadHeuristicNames(chartersRoot);

  let planFiles;
  let charterFiles;
  if (paths === null) {
    planFiles = await discoverPlanFiles(plansRoot);
    charterFiles = await discoverCharterFiles(chartersRoot);
  } else {
    planFiles = paths.filter((p) => p.endsWith('.plan.md'));
    charterFiles = paths.filter((p) => p.endsWith('.charter.md'));
  }

  if (planFiles.length === 0 && charterFiles.length === 0) {
    // An empty corpus is not a failure — the pilot artifact lands later
    // in the same Story. CI catches a regression that *deletes* the
    // pilot via the coverage gate, not this lint.
    process.stdout.write('lint:qa: ok — 0 plan(s), 0 charter(s) checked\n');
    return 0;
  }

  const allErrors = [];

  for (const file of planFiles) {
    let entryStat;
    try {
      entryStat = await stat(file);
    } catch {
      continue;
    }
    if (!entryStat.isFile()) continue;
    if (!file.endsWith('.plan.md')) continue;

    const errors = await validatePlanFile(file);
    allErrors.push(...errors);
  }

  for (const file of charterFiles) {
    let entryStat;
    try {
      entryStat = await stat(file);
    } catch {
      continue;
    }
    if (!entryStat.isFile()) continue;
    if (!file.endsWith('.charter.md')) continue;

    const errors = await validateCharterFile(file, knownHeuristics);
    allErrors.push(...errors);
  }

  const totalArtifacts = planFiles.length + charterFiles.length;
  if (allErrors.length > 0) {
    reportErrors(allErrors);
    process.stderr.write(
      `lint:qa: FAIL — ${allErrors.length} error(s) across ${totalArtifacts} artifact(s)\n`,
    );
    return 1;
  }

  process.stdout.write(
    `lint:qa: ok — ${planFiles.length} plan(s), ${charterFiles.length} charter(s) checked\n`,
  );
  return 0;
}

// Exported for unit tests so they can drive validation without spawning
// a child process.
export {
  discoverPlanFiles,
  discoverCharterFiles,
  loadHeuristicNames,
  validatePlanFile,
  validatePlanBody,
  validateCharterFile,
  validateCharterBody,
  validateCharterHeuristics,
};

// Only run when invoked directly (not when imported by tests). The
// resolved CLI argv may be undefined when the module is imported via
// `node -e "import(...)"`, so guard the comparison defensively.
const invokedAs = process.argv[1] ?? '';
const isDirectCli =
  invokedAs.length > 0 && fileURLToPath(import.meta.url) === path.resolve(invokedAs);
if (isDirectCli) {
  const code = await runLint();
  process.exit(code);
}
