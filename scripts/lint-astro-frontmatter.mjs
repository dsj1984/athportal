#!/usr/bin/env node
// scripts/lint-astro-frontmatter.mjs
//
// Astro frontmatter lint for the athportal `apps/web/src/` tree.
//
// Catches the failure mode codified by PRs #862 and #864: an `.astro`
// component's frontmatter (the `---` ... `---` block at the top of the
// file) contains the literal text `<script` inside a JS comment.
// Astro's compiler treats that token as an actual script-block opener
// and feeds the trailing comment body to esbuild as JS, which then
// produces parser errors (`Expected ";"`, `Expected ">"`,
// `Unterminated string literal`) at `pnpm dev` time on consumers of
// the offending component.
//
// The fix is mechanical: reword the comment to use the word `script`
// (no angle brackets) or `script tag`. This lint enforces the
// rewording on every push so the trap can't reopen.
//
// Scope (walk):
//   apps/web/src/**/*.astro
//
// Exit codes:
//   0 — clean. Every `.astro` frontmatter is free of the literal token.
//   1 — at least one finding. Stderr carries a per-file/line report.
//
// Output flags:
//   `--json`    emit findings as JSON on stdout instead of the human
//               report (used by the sibling unit test).
//   `--help`    print usage.
//
// Conventions:
//   - Pure Node ESM, no third-party deps. Mirrors the style of
//     `scripts/lint-orphan-bem.mjs` (`.mjs`, executed under `node`
//     directly).
//   - Pure helpers (`extractFrontmatter`, `findOffendingLines`,
//     `lintSource`) are exported for the sibling unit test
//     `scripts/lint-astro-frontmatter.test.mjs`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = ['apps', 'web', 'src'];
const TARGET_EXT = '.astro';

// The pattern we forbid in frontmatter comments. We match `<script`
// (case-insensitive) followed by either whitespace, `>`, or `/`
// (covers `<script>`, `<script lang="ts">`, `<script/>`, and the
// stray `<script` opener missing a closer). A literal `<script` is
// what trips Astro's compiler — the closing bracket is incidental.
const FORBIDDEN_TOKEN_RE = /<script(?=[\s>/])/i;

/**
 * Extract an Astro component's frontmatter block.
 *
 * Astro frontmatter is the content between the first two lines that
 * contain exactly `---` (no leading whitespace, no trailing chars
 * other than `\r`). Returns `null` when the file has no frontmatter
 * (no opening fence, or no closing fence on a line of its own).
 *
 * @param {string} source - the full file contents
 * @returns {{ text: string, startLine: number } | null}
 *   `text`      — the frontmatter content (between the fences)
 *   `startLine` — 1-indexed line number of the line **after** the
 *                 opening fence (i.e., the first content line)
 */
export function extractFrontmatter(source) {
  const lines = source.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return null;
  }
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      const body = lines.slice(1, i).join('\n');
      return { text: body, startLine: 2 };
    }
  }
  return null;
}

/**
 * Find lines inside a frontmatter block that contain the forbidden
 * `<script` token.
 *
 * @param {{ text: string, startLine: number }} frontmatter
 * @returns {Array<{ line: number, column: number, snippet: string }>}
 *   one entry per offending line, with `line` resolved to the
 *   absolute 1-indexed line number in the source file.
 */
export function findOffendingLines(frontmatter) {
  const out = [];
  const lines = frontmatter.text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = FORBIDDEN_TOKEN_RE.exec(lines[i]);
    if (match) {
      out.push({
        line: frontmatter.startLine + i,
        column: match.index + 1,
        snippet: lines[i].trim(),
      });
    }
  }
  return out;
}

/**
 * Lint a single source string. Returns the per-file findings array.
 * No I/O — caller is responsible for reading the file.
 *
 * @param {string} source
 * @returns {Array<{ line: number, column: number, snippet: string }>}
 */
export function lintSource(source) {
  const frontmatter = extractFrontmatter(source);
  if (!frontmatter) {
    return [];
  }
  return findOffendingLines(frontmatter);
}

/**
 * Walk a directory tree synchronously and yield every `.astro` file
 * path. Skips `node_modules` and `.git` to stay deterministic.
 *
 * @param {string} root - directory to walk
 * @returns {string[]} absolute paths
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
 * Run the lint against a directory tree. Returns an envelope with
 * a stable shape for both the CLI and the sibling unit test.
 *
 * @param {string} repoRoot - the directory whose `apps/web/src/` we walk
 * @returns {{
 *   findings: Array<{ path: string, line: number, column: number, snippet: string }>,
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
    return '[lint-astro-frontmatter] ok — no offending tokens';
  }
  const lines = [
    `[lint-astro-frontmatter] ${findings.length} finding(s) — ` +
      'literal `<script` token inside an Astro frontmatter comment ' +
      'will be parsed as a real script-block opener. Reword to `script` ' +
      '(no angle brackets).',
    '',
  ];
  for (const f of findings) {
    lines.push(`  x ${f.path}:${f.line}:${f.column}`);
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
      'Usage: node scripts/lint-astro-frontmatter.mjs [--json] [--help]',
      '',
      'Scans apps/web/src/**/*.astro for the literal `<script` token',
      'inside frontmatter (`---` ... `---`) comments. The token is a',
      'known Astro compiler trap (PRs #862 and #864). Reword to',
      '`script` (no angle brackets).',
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
