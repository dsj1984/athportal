#!/usr/bin/env node
// scripts/lint-astro-script-modules.mjs
//
// Astro inline-`<script>` lint for the athportal `apps/web/src/` tree.
//
// Catches the regression class first documented by Story #958 / PR #962
// and generalised by Story #966: an Astro `<script>` block that carries
// a non-directive attribute (`lang="ts"` is the documented offender)
// silently opts out of Astro's bundling pipeline. Astro emits the
// script inline, the raw ES `import` statements ship to the browser
// without `type="module"`, and every consumer of that component dies
// with `Uncaught SyntaxError: Cannot use import statement outside a
// module`.
//
// The fix is mechanical: drop `lang="ts"` (and any equivalent
// non-directive attribute) from inline `<script>` tags. Astro still
// parses TypeScript syntax inside a plain `<script>` block.
//
// Scope (walk): apps/web/src/**/*.astro
//
// Rule: forbid `lang=` on every `<script>` opening tag. This is a
// proxy for "the script must be processed as a bundled module" — it
// captures the only attribute observed in this codebase to trigger
// the opt-out. Astro's own directives (`is:inline`, `define:vars`,
// `is:raw`, `set:html`) are allowed; if a future Astro release adds
// another opt-out attribute, extend FORBIDDEN_ATTRS_RE.
//
// Exit codes:
//   0 — clean. Every `<script>` in scope is free of the forbidden
//       attribute set.
//   1 — at least one finding. Stderr carries a per-file/line report.
//
// Output flags:
//   `--json`  emit findings as JSON on stdout instead of the human
//             report (used by the sibling unit test).
//   `--help`  print usage.
//
// Conventions mirror scripts/lint-astro-frontmatter.mjs: pure Node
// ESM, no third-party deps, pure helpers exported for the test.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = ['apps', 'web', 'src'];
const TARGET_EXT = '.astro';

// Match the opening tag of an inline <script ...>. We only care about
// the opening tag; the body is whatever — Astro routes the whole tag
// based on the attributes on this opener. The lazy capture `[^>]*?`
// avoids crossing tag boundaries.
const SCRIPT_OPEN_TAG_RE = /<script(\s[^>]*?)?>/g;

// Attributes that opt a <script> out of Astro's bundling pipeline.
// `lang=` is the documented offender (Story #958, Story #966). Add
// future offenders here as they surface.
const FORBIDDEN_ATTRS_RE = /\blang\s*=/;

/**
 * Find every offending <script> opening tag in a source string.
 *
 * Pure function: caller is responsible for I/O.
 *
 * @param {string} source - full file contents
 * @returns {Array<{ line: number, column: number, snippet: string, attribute: string }>}
 *   one entry per offending opening tag. `line`/`column` are 1-indexed.
 */
export function lintSource(source) {
  const out = [];
  SCRIPT_OPEN_TAG_RE.lastIndex = 0;
  let match;
  while ((match = SCRIPT_OPEN_TAG_RE.exec(source)) !== null) {
    const attrs = match[1] ?? '';
    const attrMatch = FORBIDDEN_ATTRS_RE.exec(attrs);
    if (!attrMatch) continue;
    const tagStart = match.index;
    const before = source.slice(0, tagStart);
    const line = before.split('\n').length;
    const lastNl = before.lastIndexOf('\n');
    const column = tagStart - (lastNl === -1 ? -1 : lastNl);
    const snippet = match[0].trim();
    out.push({ line, column, snippet, attribute: attrMatch[0].trim() });
  }
  return out;
}

/**
 * Walk a directory tree synchronously and yield every `.astro` file
 * path. Mirrors lint-astro-frontmatter.mjs's walker so the two scripts
 * stay in sync.
 *
 * @param {string} root - directory to walk
 * @returns {string[]} absolute paths, sorted
 */
export function walkAstroFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(TARGET_EXT)) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

/**
 * Run the lint against a directory tree.
 *
 * @param {string} repoRoot - the directory whose `apps/web/src/` we walk
 * @returns {{
 *   findings: Array<{ path: string, line: number, column: number, snippet: string, attribute: string }>,
 *   filesScanned: number,
 * }}
 */
export function runLint(repoRoot) {
  const scopeRoot = join(repoRoot, ...SCOPE);
  try {
    if (!statSync(scopeRoot).isDirectory()) {
      return { findings: [], filesScanned: 0 };
    }
  } catch {
    return { findings: [], filesScanned: 0 };
  }
  const files = walkAstroFiles(scopeRoot);
  const findings = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const perFile = lintSource(src);
    if (perFile.length > 0) {
      const rel = relative(repoRoot, file).split(sep).join('/');
      for (const f of perFile) {
        findings.push({ path: rel, ...f });
      }
    }
  }
  return { findings, filesScanned: files.length };
}

function renderHumanReport(findings) {
  if (findings.length === 0) {
    return '[lint-astro-script-modules] ok — no forbidden <script> attributes';
  }
  const lines = [
    `[lint-astro-script-modules] ${findings.length} finding(s) — ` +
      'an Astro `<script>` opening tag carries an attribute (e.g. ' +
      '`lang="ts"`) that opts the script out of bundling. Astro will ' +
      'ship the raw `import` statements without `type="module"` and the ' +
      'browser will throw `Cannot use import statement outside a module`. ' +
      'Drop the attribute — Astro parses TS inside a plain `<script>`.',
    '',
  ];
  for (const f of findings) {
    lines.push(`  x ${f.path}:${f.line}:${f.column}  [${f.attribute}]`);
    lines.push(`      ${f.snippet}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = { json: false, help: false };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: node scripts/lint-astro-script-modules.mjs [--json] [--help]',
      '',
      'Scans apps/web/src/**/*.astro for inline `<script>` opening tags',
      'that carry a non-directive attribute (e.g. `lang="ts"`) which',
      'opts the script out of Astro bundling and ships raw `import`',
      'statements to the browser. Generalised regression guard for',
      'Story #958 / PR #962 / Story #966.',
      '',
      'Exit 0 when clean; exit 1 on any finding.',
      '',
    ].join('\n'),
  );
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const repoRoot = process.cwd();
  const result = runLint(repoRoot);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stderr.write(`${renderHumanReport(result.findings)}\n`);
  }
  process.exit(result.findings.length === 0 ? 0 : 1);
}
