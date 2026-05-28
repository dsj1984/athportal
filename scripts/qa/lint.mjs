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

import { execFile } from 'node:child_process';
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
const DEFAULT_FEATURES_ROOT = path.join(REPO_ROOT, 'tests', 'features');
const HEURISTICS_DIRNAME = '_heuristics';

// ---------------------------------------------------------------------------
// @pending TTL configuration
//
// Default is 90 days — set generously on first landing to avoid immediately
// failing the existing @pending corpus. Tighten to 30 days in a follow-up
// commit once the tracking-issue backlog is cleared (Tech Spec #1004 § F1).
// Override via PENDING_TTL_DAYS env var for migration windows.
// ---------------------------------------------------------------------------

const PENDING_TTL_DAYS = Number(process.env.PENDING_TTL_DAYS ?? '90');

// Pattern that matches an @issue-<number> tracking tag on a scenario/feature
// header line or its tag line.
const ISSUE_TAG_PATTERN = /@issue-(\d+)/;

// Matches a @pending tag anywhere in a tag expression.
const PENDING_TAG_PATTERN = /@pending\b/;

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
// @pending TTL — git-log first-seen date helper
//
// Runs `git log --diff-filter=A --format=%aI -- <file>` to find the date the
// file was first added to the repository. Results are cached per absolute
// path to avoid N+1 subprocess spawns when multiple scenarios in the same
// file are @pending.
//
// The function is deliberately NOT exported: it spawns a real git process and
// must never be called from unit tests without mocking. Tests drive the
// higher-level `scanPendingScenarios` via a `gitFirstSeenDate` override.
// ---------------------------------------------------------------------------

/** @type {Map<string, Date|null>} */
const gitFirstSeenCache = new Map();

/**
 * Resolve the ISO date at which `filePath` first appeared in git history.
 * Returns `null` when the file is untracked or the git call fails; in that
 * case the caller falls back to the file's mtime.
 *
 * @param {string} filePath  Absolute path to the file.
 * @param {string} cwd       Repository root used as git working directory.
 * @returns {Promise<Date|null>}
 */
async function gitFirstSeenDate(filePath, cwd) {
  if (gitFirstSeenCache.has(filePath)) {
    return gitFirstSeenCache.get(filePath) ?? null;
  }

  const result = await new Promise((resolve) => {
    execFile(
      'git',
      ['log', '--follow', '--diff-filter=A', '--format=%aI', '--', filePath],
      { cwd },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const line = stdout.trim().split('\n').at(-1)?.trim() ?? '';
        resolve(line.length > 0 ? new Date(line) : null);
      },
    );
  });

  gitFirstSeenCache.set(filePath, result);
  return result;
}

/**
 * Resolve the first-seen date for a .feature file. Uses git log when
 * available; falls back to file mtime when git returns nothing.
 *
 * @param {string} filePath  Absolute path to the .feature file.
 * @param {string} repoRoot  Repository root for the git call.
 * @returns {Promise<Date>}
 */
async function resolveFirstSeenDate(filePath, repoRoot) {
  const gitDate = await gitFirstSeenDate(filePath, repoRoot);
  if (gitDate !== null && !Number.isNaN(gitDate.getTime())) {
    return gitDate;
  }
  // Fallback: file mtime
  try {
    const info = await stat(filePath);
    return info.mtime;
  } catch {
    return new Date();
  }
}

// ---------------------------------------------------------------------------
// @pending TTL — .feature file scanner
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PendingViolation
 * @property {string} file         Absolute path to the .feature file.
 * @property {string} scenario     Title of the offending Scenario or Feature.
 * @property {'over-ttl'|'missing-issue-tag'} kind  Violation type.
 * @property {number} [ageDays]    Populated for 'over-ttl' violations.
 */

/**
 * Scan a single .feature file for @pending scenarios that are past the TTL
 * or missing an @issue-<number> co-tag.
 *
 * Gherkin is parsed line-by-line. A "scenario block" begins at the first
 * `Scenario:` / `Scenario Outline:` / `Example:` line (or the `Feature:`
 * line itself when the Feature is tagged @pending). Tags on the immediately
 * preceding consecutive tag lines belong to the scenario.
 *
 * @param {string}   filePath          Absolute path to the .feature file.
 * @param {string}   repoRoot          Repository root for git log.
 * @param {number}   ttlDays           TTL threshold in days.
 * @param {Function} [resolveDateFn]   Injectable for unit tests; defaults to
 *                                     `resolveFirstSeenDate`.
 * @returns {Promise<PendingViolation[]>}
 */
async function scanPendingInFeatureFile(
  filePath,
  repoRoot,
  ttlDays,
  resolveDateFn = resolveFirstSeenDate,
) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  const violations = [];
  const lines = raw.split(/\r?\n/);

  // Collect the file's first-seen date once; shared for all scenarios in file.
  const firstSeen = await resolveDateFn(filePath, repoRoot);
  const now = Date.now();
  const ageDays = (now - firstSeen.getTime()) / (1000 * 60 * 60 * 24);

  // Walk through lines accumulating pending tag blocks and scenario titles.
  // A pending block is a run of @tag lines immediately before a Scenario or
  // Feature keyword line.

  /** @type {string[]} Accumulated tag tokens from the current tag-line run */
  let pendingTagBuffer = [];
  /** Whether the tag buffer contains @pending */
  let hasPending = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('@')) {
      // Tag line — accumulate tokens into buffer
      const tokens = trimmed.split(/\s+/);
      for (const tok of tokens) {
        pendingTagBuffer.push(tok);
        if (PENDING_TAG_PATTERN.test(tok)) hasPending = true;
      }
      continue;
    }

    const isScenario =
      /^Scenario\s*:/i.test(trimmed) ||
      /^Scenario\s+Outline\s*:/i.test(trimmed) ||
      /^Example\s*:/i.test(trimmed);
    const isFeature = /^Feature\s*:/i.test(trimmed);

    if (isScenario || isFeature) {
      if (hasPending) {
        const titleMatch = trimmed.match(
          /^(?:Scenario(?:\s+Outline)?|Example|Feature)\s*:\s*(.*)/i,
        );
        const scenarioTitle = titleMatch?.[1]?.trim() ?? trimmed;

        const hasIssueTag = pendingTagBuffer.some((tok) => ISSUE_TAG_PATTERN.test(tok));

        // Over-TTL check
        if (ageDays > ttlDays) {
          violations.push({
            file: filePath,
            scenario: scenarioTitle,
            kind: 'over-ttl',
            ageDays: Math.floor(ageDays),
          });
        }

        // Missing tracking-issue tag check (always enforced, independent of TTL)
        if (!hasIssueTag) {
          violations.push({
            file: filePath,
            scenario: scenarioTitle,
            kind: 'missing-issue-tag',
          });
        }
      }

      // Reset buffer after consuming a scenario/feature header
      pendingTagBuffer = [];
      hasPending = false;
      continue;
    }

    // Any other non-empty, non-comment line resets the tag buffer
    if (trimmed.length > 0 && !trimmed.startsWith('#')) {
      pendingTagBuffer = [];
      hasPending = false;
    }
  }

  return violations;
}

/**
 * Scan every .feature file under `featuresRoot` for @pending TTL violations.
 *
 * @param {string}   featuresRoot      Root directory for .feature discovery.
 * @param {string}   repoRoot          Repository root for git log.
 * @param {number}   ttlDays           TTL threshold in days.
 * @param {Function} [resolveDateFn]   Injectable for unit tests.
 * @returns {Promise<Array<{file:string,field:string,message:string}>>}
 */
async function scanAllPendingFeatures(
  featuresRoot,
  repoRoot,
  ttlDays,
  resolveDateFn = resolveFirstSeenDate,
) {
  const featureFiles = await discoverArtifacts(featuresRoot, '.feature');
  const allErrors = [];

  for (const file of featureFiles) {
    const violations = await scanPendingInFeatureFile(file, repoRoot, ttlDays, resolveDateFn);
    for (const v of violations) {
      if (v.kind === 'over-ttl') {
        allErrors.push({
          file: v.file,
          field: '@pending',
          message: `scenario "${v.scenario}" has been @pending for ${v.ageDays} day(s) (TTL: ${ttlDays} days) — bind the step or remove @pending to resolve this scenario`,
        });
      } else {
        allErrors.push({
          file: v.file,
          field: '@pending',
          message: `scenario "${v.scenario}" is @pending but missing a tracking @issue-<number> tag`,
        });
      }
    }
  }

  return allErrors;
}

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
 *   - `plansRoot`       — override the plan discovery root (test fixtures)
 *   - `chartersRoot`    — override the charter discovery root (test fixtures)
 *   - `featuresRoot`    — override the .feature discovery root (test fixtures)
 *   - `repoRoot`        — override the repo root used for git log calls
 *   - `pendingTtlDays`  — override the @pending TTL in days (default: PENDING_TTL_DAYS)
 *   - `paths`           — when provided, validate exactly this list of file
 *                         paths instead of recursive discovery; each path is
 *                         dispatched on its suffix (`.plan.md` vs `.charter.md`).
 *   - `resolveDateFn`   — injectable date resolver for unit tests (bypasses git)
 */
export async function runLint({
  plansRoot = DEFAULT_PLANS_ROOT,
  chartersRoot = DEFAULT_CHARTERS_ROOT,
  /**
   * Root for .feature file discovery. Pass `null` to disable the @pending
   * TTL scan entirely (e.g. in unit tests that do not need feature scanning).
   * Defaults to `null` so callers that only override `plansRoot` / `chartersRoot`
   * are not unexpectedly affected by the @pending gate. The CLI entry-point
   * below explicitly passes `DEFAULT_FEATURES_ROOT` so the full corpus scan
   * runs in CI.
   */
  featuresRoot = null,
  repoRoot = REPO_ROOT,
  pendingTtlDays = PENDING_TTL_DAYS,
  paths = null,
  resolveDateFn = undefined,
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

  // @pending TTL scan pass — runs over all .feature files under featuresRoot.
  // Skipped when:
  //   - `featuresRoot` is null (caller explicitly opted out, or the default)
  //   - `paths` is provided (pre-commit staged-file mode — the staged list
  //     contains .plan.md / .charter.md only; a partial feature scan would
  //     be misleading). The full TTL scan runs in CI via `pnpm run lint:qa`.
  if (featuresRoot !== null && paths === null) {
    const pendingErrors = await scanAllPendingFeatures(
      featuresRoot,
      repoRoot,
      pendingTtlDays,
      resolveDateFn,
    );
    allErrors.push(...pendingErrors);
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
  scanPendingInFeatureFile,
  scanAllPendingFeatures,
  PENDING_TTL_DAYS,
};

// Only run when invoked directly (not when imported by tests). The
// resolved CLI argv may be undefined when the module is imported via
// `node -e "import(...)"`, so guard the comparison defensively.
const invokedAs = process.argv[1] ?? '';
const isDirectCli =
  invokedAs.length > 0 && fileURLToPath(import.meta.url) === path.resolve(invokedAs);
if (isDirectCli) {
  // Positional args (anything that is not a `--`-prefixed flag) are
  // treated as explicit artifact paths. The Husky `pre-commit` hook
  // uses this to scope lint:qa to staged `.plan.md` / `.charter.md`
  // files only; CI continues to invoke `pnpm run lint:qa` with no args
  // so the full corpus is checked.
  //
  // The CLI path explicitly enables the @pending TTL scan by passing
  // `DEFAULT_FEATURES_ROOT`. Tests that call `runLint()` directly and do
  // not pass `featuresRoot` default to `null` (scan disabled) so they are
  // not inadvertently affected by the gate.
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const paths = positional.length > 0 ? positional.map((p) => path.resolve(p)) : null;
  const code = await runLint({ paths, featuresRoot: DEFAULT_FEATURES_ROOT });
  process.exit(code);
}
