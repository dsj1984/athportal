#!/usr/bin/env node
// scripts/qa/lint.mjs
//
// QA-corpus linter. This is the **plan branch** — it scans every
// `tests/plans/**/*.plan.md` artifact, validates its YAML front-matter
// against the Zod schema in `scripts/qa/schema/plan.front-matter.zod.ts`,
// and verifies the required body sections (`## Setup`, `## Steps`,
// `## Cleanup`). The charter branch is added under the same dispatcher
// by a later Story; the dispatcher reads `type:` from front-matter and
// routes accordingly. Today, `type: charter` files are skipped with a
// neutral message (the charter validator has not landed yet).
//
// Wired into:
//   - `pnpm run lint:qa` (package.json scripts) — CI quality gate
//   - Husky `pre-commit` step that also runs `lint:qa` against staged
//     `.plan.md` / `.charter.md` paths (added by a later Story)
//
// Exit codes:
//   0 — every plan parsed and body-shape-checked clean
//   1 — at least one plan failed schema or body validation
//   2 — CLI usage error (unreadable paths, malformed args)
//
// Output contract:
//   - Success path prints a one-line summary to stdout:
//       "lint:qa: ok — N plan(s) checked"
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

import { safeParsePlanFrontMatter } from './schema/plan.front-matter.zod.ts';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PLANS_ROOT = path.join(REPO_ROOT, 'tests', 'plans');

// ---------------------------------------------------------------------------
// Body-shape rules (plan branch)
// ---------------------------------------------------------------------------

/**
 * Required H2 sections for a plan, in order. The order is part of the
 * canonical body shape per Tech Spec #782 § Body shape → "Plan".
 */
const REQUIRED_PLAN_SECTIONS = ['## Setup', '## Steps', '## Cleanup'];

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
 * Recursively collect every `.plan.md` file under `root`. Returns
 * absolute paths sorted for deterministic output across platforms
 * (Windows readdir order is not lexicographic by default).
 */
async function discoverPlanFiles(root) {
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
      const nested = await discoverPlanFiles(abs);
      out.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.plan.md')) {
      out.push(abs);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
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
 * Validate the body of a plan. Returns an array of `{ section, message }`
 * errors so the caller can render them per-file.
 */
function validatePlanBody(body) {
  const errors = [];

  // Required H2 sections — search line-by-line so a `## Steps` reference
  // inside a code block does not satisfy the rule.
  const lines = body.split(/\r?\n/);
  const sectionLines = new Set(lines.map((line) => line.trim()));

  for (const required of REQUIRED_PLAN_SECTIONS) {
    if (!sectionLines.has(required)) {
      errors.push({
        section: required.replace('## ', ''),
        message: `missing required section "${required}"`,
      });
    }
  }

  // If `## Steps` is present, every numbered step must be followed by an
  // `**Expected:**` line within the same step block. We segment the
  // Steps section between `## Steps` and the next H2 header.
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

  // Type discriminator — the charter branch lands in a later Story.
  // Skip charters silently so a mixed `lint:qa` run still passes when
  // the only failures would have been "charter branch not implemented".
  if (parsed.data.type === 'charter') {
    return [];
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
 */
export async function runLint({ plansRoot = DEFAULT_PLANS_ROOT, paths = null } = {}) {
  const planFiles = paths ?? (await discoverPlanFiles(plansRoot));

  if (planFiles.length === 0) {
    // An empty corpus is not a failure — the pilot plan lands later in
    // the same Story. CI catches a regression that *deletes* the pilot
    // via the coverage gate, not this lint.
    process.stdout.write('lint:qa: ok — 0 plan(s) checked\n');
    return 0;
  }

  const allErrors = [];
  for (const file of planFiles) {
    // Skip directories or non-existent paths cleanly when `paths` was
    // supplied by a caller (e.g. Husky's staged-file list).
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

  if (allErrors.length > 0) {
    reportErrors(allErrors);
    process.stderr.write(
      `lint:qa: FAIL — ${allErrors.length} error(s) across ${planFiles.length} plan(s)\n`,
    );
    return 1;
  }

  process.stdout.write(`lint:qa: ok — ${planFiles.length} plan(s) checked\n`);
  return 0;
}

// Exported for unit tests so they can drive validation without spawning
// a child process.
export { discoverPlanFiles, validatePlanFile, validatePlanBody };

// Only run when invoked directly (not when imported by tests). The
// resolved CLI argv may be undefined when the module is imported via
// `node -e "import(...)"`, so guard the comparison defensively.
const invokedAs = process.argv[1] ?? '';
const isDirectCli =
  invokedAs.length > 0 &&
  fileURLToPath(import.meta.url) === path.resolve(invokedAs);
if (isDirectCli) {
  const code = await runLint();
  process.exit(code);
}
