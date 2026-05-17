#!/usr/bin/env node
// scripts/lint-steps.mjs
//
// Step-definition linter for the BDD acceptance tier.
//
// Enforces three rule classes against the canonical step library
// (apps/web/e2e/steps/**/*.ts) and the Gherkin corpus
// (tests/features/**/*.feature):
//
//   1. Forbidden patterns in step bodies (errors):
//      - no-raw-sql          raw SQL literal (SELECT/INSERT/UPDATE/DELETE ... FROM/INTO/TABLE/WHERE)
//      - no-status-code      HTTP status-code assertion (expect(res.status).toBe(NNN))
//      - no-dom-selector     page.locator(...) / request.fetch(...) raw selectors
//      - no-api-url-literal  string literal beginning with `/api/`
//
//   2. Duplicate-phrase detection (error):
//      The same Given/When/Then phrase declared in two different step files.
//
//   3. Unused-step warning (warning, not error):
//      A defined phrase that matches zero scenarios in the corpus. This
//      becomes an error at Epic close per docs/testing-strategy.md, but
//      ships as a warning during normal development.
//
// CLI:
//   node scripts/lint-steps.mjs           Lint the whole corpus (default)
//   node scripts/lint-steps.mjs --staged  Lint only files in `git diff --cached --name-only`
//                                         that match the step/feature globs. Exits 0 when
//                                         no staged path is in scope (fast path for commits
//                                         that touch unrelated trees).
//   node scripts/lint-steps.mjs --fixtures Lint the fixture tree under
//                                         scripts/__fixtures__/lint-steps/ and assert each
//                                         fixture is rejected by exactly one rule (AC-5
//                                         evidence harness for Task #187).
//
// Exit codes:
//   0  clean (or only warnings)
//   1  one or more rule errors
//   2  CLI usage error / unreadable input

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI argv parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { staged: false, fixtures: false };
  for (const a of argv.slice(2)) {
    if (a === '--staged') args.staged = true;
    else if (a === '--fixtures') args.fixtures = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      process.stderr.write(`lint-steps: unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Filesystem walking
// ---------------------------------------------------------------------------

const STEP_GLOB_DIR = path.join('apps', 'web', 'e2e', 'steps');
const FEATURE_GLOB_DIR = path.join('tests', 'features');
const FIXTURE_DIR = path.join('scripts', '__fixtures__', 'lint-steps');

function walk(dir, predicate, out = []) {
  const abs = path.isAbsolute(dir) ? dir : path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(abs, entry.name);
    if (entry.isDirectory()) walk(child, predicate, out);
    else if (entry.isFile() && predicate(child)) out.push(child);
  }
  return out;
}

function findStepFiles(root = STEP_GLOB_DIR) {
  return walk(root, (p) => p.endsWith('.steps.ts'));
}

function findFeatureFiles() {
  return walk(FEATURE_GLOB_DIR, (p) => p.endsWith('.feature'));
}

// ---------------------------------------------------------------------------
// Step-definition extraction
// ---------------------------------------------------------------------------

// Match Given|When|Then('phrase', async (...) => { ... })
// or with template literal phrase. We capture the phrase text *and* the body
// text so the forbidden-pattern rule can scan the body.
//
// The body extraction is regex-based — robust enough for the project's
// playwright-bdd usage which writes step bodies inline. Multi-line bodies
// are captured by greedily matching to the next `});` at the same brace
// depth via a simple state machine.

function parseSteps(source, filePath) {
  const steps = [];
  const stepKindRe = /\b(Given|When|Then)\s*\(\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;
  let match = stepKindRe.exec(source);
  while (match !== null) {
    const kind = match[1];
    const phrase = match[3];
    const start = match.index;
    // Find the body of the step call. Walk forward from the phrase's closing
    // quote, find the comma, then capture until the matching `);` at brace
    // depth 0.
    const phraseEnd = stepKindRe.lastIndex;
    const bodyInfo = extractCallBody(source, phraseEnd);
    if (bodyInfo) {
      steps.push({
        kind,
        phrase,
        body: bodyInfo.body,
        file: filePath,
        line: lineOf(source, start),
      });
    }
    match = stepKindRe.exec(source);
  }
  return steps;
}

/**
 * Given a position inside a step call (after the phrase literal), find the
 * substring of the source corresponding to the rest of the call's arguments,
 * up to and including the matching `);`. Returns the trimmed body text.
 */
function extractCallBody(source, fromIdx) {
  let i = fromIdx;
  let depth = 1; // we entered with the opening '(' of the step call
  let inStr = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  const startBody = i;
  while (i < source.length && depth > 0) {
    const c = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      i++;
      continue;
    }
    if (blockComment) {
      if (c === '*' && next === '/') {
        blockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      if (escaped) {
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
      } else if (c === inStr) {
        inStr = null;
      }
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      lineComment = true;
      i += 2;
      continue;
    }
    if (c === '/' && next === '*') {
      blockComment = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c;
      i++;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return { body: source.slice(startBody, i - 1) };
}

function lineOf(source, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Gherkin phrase extraction
// ---------------------------------------------------------------------------

/**
 * Pull the step-text part of every Given/When/Then/And/But line. Returns
 * an array of `{ text, file, line }`. Comments and the `Background`/
 * `Scenario` headers are ignored.
 */
function parseFeature(source, filePath) {
  const out = [];
  const lines = source.split(/\r?\n/);
  const stepRe = /^\s*(Given|When|Then|And|But)\s+(.+?)\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = stepRe.exec(lines[i]);
    if (!m) continue;
    out.push({ text: m[2], file: filePath, line: i + 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phrase ↔ scenario matching
// ---------------------------------------------------------------------------

/**
 * Convert a step-definition phrase into a regex that matches scenario step
 * text. Mirrors playwright-bdd / Cucumber semantics for the cucumber-style
 * placeholders we use in this repo: `{word}`, `{int}`, `{string}`. Anything
 * outside those placeholders is escaped literally.
 */
function phraseToRegex(phrase) {
  const PLACEHOLDER = /\{(word|int|string|float)\}/g;
  let out = '';
  let last = 0;
  let m = PLACEHOLDER.exec(phrase);
  while (m !== null) {
    out += escapeRegex(phrase.slice(last, m.index));
    switch (m[1]) {
      case 'word':
        out += '\\S+';
        break;
      case 'int':
        out += '-?\\d+';
        break;
      case 'float':
        out += '-?\\d+(?:\\.\\d+)?';
        break;
      case 'string':
        out += '"[^"]*"|\\\'[^\\\']*\\\'';
        break;
    }
    last = PLACEHOLDER.lastIndex;
    m = PLACEHOLDER.exec(phrase);
  }
  out += escapeRegex(phrase.slice(last));
  return new RegExp(`^${out}$`);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Forbidden-pattern rules
// ---------------------------------------------------------------------------

const FORBIDDEN_RULES = [
  {
    code: 'no-raw-sql',
    description: 'raw SQL literal in step body',
    // Match SELECT/INSERT/UPDATE/DELETE keywords paired with FROM/INTO/TABLE/SET/WHERE.
    // Case-insensitive; tolerates the surrounding string-literal quote.
    regex: /\b(SELECT\s+[\s\S]*?\bFROM\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b)/i,
  },
  {
    code: 'no-status-code',
    description: 'HTTP status-code assertion in step body (push to contract tier)',
    // expect(res.status).toBe(200), expect(response.statusCode).toEqual(403), etc.
    regex:
      /\bexpect\s*\(\s*[\w.]*status(?:Code)?\s*\)\s*\.\s*to(?:Be|Equal|StrictEqual)\s*\(\s*\d{3}\s*\)/,
  },
  {
    code: 'no-dom-selector',
    description: 'raw selector via page.locator(...) or request.fetch(...)',
    regex: /\b(page\.locator\s*\(|request\.fetch\s*\()/,
  },
  {
    code: 'no-api-url-literal',
    description: '/api/ URL literal in step body',
    // Match a string literal starting with /api/ (single, double, or template quote).
    regex: /(['"`])\/api\/[^'"`]*\1/,
  },
];

// ---------------------------------------------------------------------------
// Linting pipeline
// ---------------------------------------------------------------------------

function relPath(abs) {
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

/**
 * Lint a set of step files + a set of feature files. Returns
 * `{ errors: Finding[], warnings: Finding[], stepCount, featureCount }`.
 */
function lintCorpus({ stepFiles, featureFiles, checkUnused = true }) {
  const errors = [];
  const warnings = [];
  const allSteps = []; // { kind, phrase, body, file, line }

  // Parse all step files.
  for (const f of stepFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const steps = parseSteps(src, f);
    allSteps.push(...steps);
  }

  // Rule 1 — forbidden patterns in step bodies.
  for (const step of allSteps) {
    for (const rule of FORBIDDEN_RULES) {
      if (rule.regex.test(step.body)) {
        errors.push({
          code: rule.code,
          message: `${rule.description}`,
          file: relPath(step.file),
          line: step.line,
          phrase: step.phrase,
        });
      }
    }
  }

  // Rule 2 — duplicate phrase detection across files. Two step definitions
  // share a phrase when their regex-form is identical AND they live in
  // different files. (Two declarations in the SAME file are not a duplicate
  // for purposes of this rule — that case is caught by playwright-bdd at
  // registration time.)
  const byKey = new Map();
  for (const step of allSteps) {
    const key = `${step.kind}::${step.phrase}`;
    const list = byKey.get(key) ?? [];
    list.push(step);
    byKey.set(key, list);
  }
  for (const [key, list] of byKey.entries()) {
    if (list.length < 2) continue;
    const distinctFiles = new Set(list.map((s) => s.file));
    if (distinctFiles.size < 2) continue;
    const files = Array.from(distinctFiles)
      .map((f) => relPath(f))
      .sort();
    errors.push({
      code: 'no-duplicate-phrase',
      message: `duplicate step phrase "${list[0].phrase}" defined in ${files.length} files: ${files.join(', ')}`,
      file: files[0],
      line: list[0].line,
      phrase: list[0].phrase,
    });
  }

  // Rule 3 — unused-step warning. A step is "used" when at least one scenario
  // line matches its regex. Aggregate scenario lines first.
  let scenarioLines = [];
  for (const f of featureFiles) {
    const src = fs.readFileSync(f, 'utf8');
    scenarioLines = scenarioLines.concat(parseFeature(src, f));
  }
  if (checkUnused) {
    for (const step of allSteps) {
      const re = phraseToRegex(step.phrase);
      const matched = scenarioLines.some((s) => re.test(s.text));
      if (!matched) {
        warnings.push({
          code: 'unused-step',
          message: `step phrase "${step.phrase}" has no matching scenario line`,
          file: relPath(step.file),
          line: step.line,
          phrase: step.phrase,
        });
      }
    }
  }

  return {
    errors,
    warnings,
    stepCount: allSteps.length,
    featureCount: featureFiles.length,
  };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function formatFinding(level, f) {
  return `${level} ${f.file}:${f.line}  [${f.code}]  ${f.message}`;
}

function emitReport(report) {
  for (const e of report.errors) process.stderr.write(`${formatFinding('✖', e)}\n`);
  for (const w of report.warnings) process.stderr.write(`${formatFinding('⚠', w)}\n`);
  const summary = `lint-steps: ${report.stepCount} step(s), ${report.featureCount} feature file(s), ${report.errors.length} error(s), ${report.warnings.length} warning(s)`;
  process.stderr.write(`${summary}\n`);
}

// ---------------------------------------------------------------------------
// --staged short-circuit
// ---------------------------------------------------------------------------

function stagedPaths() {
  const res = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (res.status !== 0) {
    process.stderr.write(`lint-steps: \`git diff --cached\` failed: ${res.stderr}\n`);
    process.exit(2);
  }
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function filterInScope(paths) {
  return paths.filter((p) => {
    const norm = p.split(path.sep).join('/');
    return (
      (norm.startsWith('apps/web/e2e/steps/') && norm.endsWith('.steps.ts')) ||
      (norm.startsWith('tests/features/') && norm.endsWith('.feature'))
    );
  });
}

// ---------------------------------------------------------------------------
// --fixtures mode (AC-5 evidence harness)
// ---------------------------------------------------------------------------

/**
 * Walk scripts/__fixtures__/lint-steps/ and assert each fixture file is
 * rejected by exactly one rule. The fixture-naming convention pins the
 * expected rule code to the filename:
 *
 *   raw-sql.steps.ts            → no-raw-sql
 *   status-code.steps.ts        → no-status-code
 *   dom-selector.steps.ts       → no-dom-selector
 *   api-url.steps.ts            → no-api-url-literal
 *   duplicate-phrase-a.steps.ts ┐
 *   duplicate-phrase-b.steps.ts ┘ → no-duplicate-phrase  (paired lint)
 *
 * Any extra rule added in the future just needs a sibling fixture file.
 */
const FIXTURE_EXPECTATIONS = {
  'raw-sql.steps.ts': 'no-raw-sql',
  'status-code.steps.ts': 'no-status-code',
  'dom-selector.steps.ts': 'no-dom-selector',
  'api-url.steps.ts': 'no-api-url-literal',
};

const DUPLICATE_FIXTURE_PAIR = ['duplicate-phrase-a.steps.ts', 'duplicate-phrase-b.steps.ts'];

function lintFixtureSingle(fixturePath, expectedCode) {
  const report = lintCorpus({
    stepFiles: [fixturePath],
    featureFiles: [],
    // Don't emit unused-step warnings for fixtures — they have no paired scenario.
    checkUnused: false,
  });
  const codes = report.errors.map((e) => e.code);
  const ok = codes.length === 1 && codes[0] === expectedCode;
  return { ok, codes, report };
}

function lintFixtureDuplicates(pairAbs) {
  const report = lintCorpus({
    stepFiles: pairAbs,
    featureFiles: [],
    checkUnused: false,
  });
  // Expected: exactly one no-duplicate-phrase error, no other errors.
  const dup = report.errors.filter((e) => e.code === 'no-duplicate-phrase');
  const other = report.errors.filter((e) => e.code !== 'no-duplicate-phrase');
  return {
    ok: dup.length === 1 && other.length === 0,
    codes: report.errors.map((e) => e.code),
    report,
  };
}

function runFixturesMode() {
  const dirAbs = path.join(REPO_ROOT, FIXTURE_DIR);
  if (!fs.existsSync(dirAbs)) {
    process.stderr.write(`lint-steps: fixtures directory missing at ${FIXTURE_DIR}\n`);
    process.exit(2);
  }
  let failures = 0;

  for (const [filename, expectedCode] of Object.entries(FIXTURE_EXPECTATIONS)) {
    const abs = path.join(dirAbs, filename);
    if (!fs.existsSync(abs)) {
      process.stderr.write(`✖ ${FIXTURE_DIR}/${filename}  missing fixture\n`);
      failures++;
      continue;
    }
    const { ok, codes } = lintFixtureSingle(abs, expectedCode);
    if (ok) {
      process.stdout.write(`✓ ${FIXTURE_DIR}/${filename}  rejected by [${expectedCode}]\n`);
    } else {
      process.stderr.write(
        `✖ ${FIXTURE_DIR}/${filename}  expected [${expectedCode}], got [${codes.join(', ') || '<none>'}]\n`,
      );
      failures++;
    }
  }

  // Duplicate-phrase pair.
  const pairAbs = DUPLICATE_FIXTURE_PAIR.map((n) => path.join(dirAbs, n));
  const missingDup = pairAbs.filter((p) => !fs.existsSync(p));
  if (missingDup.length > 0) {
    for (const m of missingDup) {
      process.stderr.write(`✖ ${relPath(m)}  missing fixture\n`);
      failures++;
    }
  } else {
    const { ok, codes } = lintFixtureDuplicates(pairAbs);
    if (ok) {
      process.stdout.write(
        `✓ ${DUPLICATE_FIXTURE_PAIR.join(' + ')}  rejected by [no-duplicate-phrase]\n`,
      );
    } else {
      process.stderr.write(
        `✖ ${DUPLICATE_FIXTURE_PAIR.join(' + ')}  expected [no-duplicate-phrase], got [${codes.join(', ') || '<none>'}]\n`,
      );
      failures++;
    }
  }

  if (failures > 0) {
    process.stderr.write(`lint-steps: ${failures} fixture(s) failed AC-5 evidence check\n`);
    process.exit(1);
  }
  process.stdout.write(
    `lint-steps: all ${Object.keys(FIXTURE_EXPECTATIONS).length + 1} fixture group(s) rejected as expected\n`,
  );
}

// ---------------------------------------------------------------------------
// Programmatic API (consumed by Vitest self-tests in scripts/__tests__/)
// ---------------------------------------------------------------------------

export {
  FORBIDDEN_RULES,
  FIXTURE_EXPECTATIONS,
  DUPLICATE_FIXTURE_PAIR,
  parseSteps,
  parseFeature,
  phraseToRegex,
  lintCorpus,
  lintFixtureSingle,
  lintFixtureDuplicates,
  findStepFiles,
  findFeatureFiles,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      [
        'Usage: lint-steps [--staged] [--fixtures]',
        '',
        '  Lint the BDD step library and Gherkin corpus.',
        '',
        '  --staged    Lint only files in `git diff --cached --name-only`',
        '              that match apps/web/e2e/steps/**/*.ts or',
        '              tests/features/**/*.feature. Exits 0 when no path',
        '              in scope.',
        '  --fixtures  Lint the rejecting-fixture tree under',
        '              scripts/__fixtures__/lint-steps/ and assert each',
        '              fixture is rejected by its expected rule (AC-5).',
        '',
      ].join('\n'),
    );
    process.exit(0);
  }

  if (args.fixtures) {
    runFixturesMode();
    return;
  }

  let stepFiles;
  let featureFiles;
  let checkUnused = true;

  if (args.staged) {
    const staged = filterInScope(stagedPaths());
    if (staged.length === 0) {
      // Fast path — staged commit touches no step/feature file.
      process.stdout.write('lint-steps: no staged step or feature file in scope; skipping\n');
      process.exit(0);
    }
    stepFiles = staged.filter((p) => p.endsWith('.steps.ts')).map((p) => path.join(REPO_ROOT, p));
    featureFiles = staged.filter((p) => p.endsWith('.feature')).map((p) => path.join(REPO_ROOT, p));
    // In --staged mode we cannot reliably emit unused-step warnings without
    // the full corpus context (a staged step file's pair scenario may live
    // outside the staged set). Skip rule 3 in --staged mode.
    checkUnused = false;
  } else {
    stepFiles = findStepFiles();
    featureFiles = findFeatureFiles();
  }

  const report = lintCorpus({ stepFiles, featureFiles, checkUnused });
  emitReport(report);
  if (report.errors.length > 0) process.exit(1);
}

// Run when invoked as a CLI; stay quiet when imported as a module.
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('lint-steps.mjs');
if (isMain) main();
