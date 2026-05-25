#!/usr/bin/env node
// scripts/lint-orphan-bem.mjs
//
// Orphan-BEM lint for the athportal `apps/web/src/` tree.
//
// Codifies ADR-0007 — `docs/decisions/0007-ui-styling-convention.md`:
// a class name matching the BEM block-element shape
// (`[\w-]+__[\w-]+`) or the BEM modifier shape (`[\w-]+--[\w-]+`)
// inside any `apps/web/src/**` `.astro` or `.tsx` file MUST resolve to
// one of the following sources (the "resolver set"):
//
//   (a) a class rule in a colocated `<style>` block in the same file,
//   (b) a class rule defined in `apps/web/src/styles/global.css`,
//   (c) a `cva` variant declared in an imported primitive's `.ts`
//       builder under `apps/web/src/components/ui/`, OR
//   (d) a colocated `<script>` block in the same file that references
//       the class name as a CSS selector (`.<name>`) or a `classList`
//       / `querySelector` argument — i.e. the class is used as a
//       documented JS hook by the same file.
//
// A class name that matches the BEM shape but does not resolve via any
// of the four sources above is reported as an **orphan BEM hook** and
// causes a non-zero exit with a per-file/line report.
//
// Scope (walk):
//   apps/web/src/**/*.astro
//   apps/web/src/**/*.tsx
//
// Excluded: anything outside `apps/web/src/`, plus `*.test.ts(x)` and
// `*.test.mjs` files (the lint is a styling/markup concern, not a test
// concern).
//
// Output:
//   `--report`  default. Prints findings to stderr and exits non-zero
//               when any orphan is found.
//   `--json`    emit the findings array as JSON on stdout instead of
//               the human report (used by the sibling unit test).
//   `--help`    print usage.
//
// Allowlist:
//   `.lint-orphan-bem-allowlist.json` at the repo root (sibling of
//   `.lint-baseline.json`) carries a list of `{path, classes[]}`
//   entries. Class names listed in the allowlist for a given file are
//   tolerated even when they would otherwise fail the resolver set;
//   the allowlist is the lint's escape hatch for pre-existing orphans
//   that the codifying Story (#834) is too narrow to refactor. Stories
//   that bring a file into compliance MUST drop the file's entry from
//   the allowlist in the same PR.
//
// Conventions:
//   - Pure Node ESM, no third-party deps. Mirrors the style of
//     `scripts/lint-baseline.mjs` (`.mjs`, executed under `node`
//     directly, shell-agnostic).
//   - Reads files synchronously — the tree is small and the script
//     runs in `pre-push` and CI where deterministic ordering and a
//     simple stack-trace are more useful than streaming I/O.
//   - The pure helpers (`extractBemCandidates`, `collectResolvers`,
//     `findOrphans`) are exported for the sibling unit test
//     `scripts/lint-orphan-bem.test.mjs`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const WEB_SRC_ROOT = path.join(REPO_ROOT, 'apps', 'web', 'src');
export const GLOBAL_CSS_PATH = path.join(WEB_SRC_ROOT, 'styles', 'global.css');
export const UI_PRIMITIVES_ROOT = path.join(WEB_SRC_ROOT, 'components', 'ui');
export const ALLOWLIST_PATH = path.join(REPO_ROOT, '.lint-orphan-bem-allowlist.json');

// BEM block-element (`block__element`) or modifier (`block--modifier`).
// Anchored on word boundaries so it does not over-match Tailwind classes
// like `data-[state=open]:bg-foo` (which contain `]:` and brackets — not
// matched by `[\w-]+`).
export const BEM_BLOCK_ELEMENT = /[A-Za-z][\w-]*__[A-Za-z][\w-]*/g;
export const BEM_MODIFIER = /[A-Za-z][\w-]*--[A-Za-z][\w-]*/g;

// Class attribute on a JSX/Astro element. Captures the literal value
// between quotes. We do not attempt to parse template expressions
// (`class={`...`}`); BEM class strings in the codebase are authored as
// quoted literals, and template-resolved classes go through `cn` /
// `cva` (which are themselves resolver path (c)).
const CLASS_ATTR_RE = /\bclass(?:Name|:list)?\s*=\s*"([^"]+)"/g;

// Tagged template / string literal forms that carry BEM-shaped class
// names through builder helpers (`cn('foo__bar', …)`, `cva('base', { …
// 'foo__bar': '…' })`). We match a single-quoted, double-quoted, or
// backticked literal and let the BEM regexes filter the candidates.
const STRING_LITERAL_RE = /['"`]([^'"`\n]+)['"`]/g;

/**
 * Strip `<script>` and `<style>` blocks (and their content) from an
 * Astro/TSX source string so the class-attribute scan only inspects
 * markup. The blocks are inspected separately by `collectResolvers` /
 * `collectScriptReferences`.
 *
 * Implemented with a flat tag-aware scan rather than a regex to avoid
 * backtracking on long files.
 */
export function stripScriptAndStyle(source) {
  const tags = ['script', 'style'];
  let out = '';
  let i = 0;
  while (i < source.length) {
    let consumed = false;
    for (const tag of tags) {
      const open = `<${tag}`;
      if (source.startsWith(open, i)) {
        const gt = source.indexOf('>', i + open.length);
        if (gt === -1) {
          // Malformed; emit the rest verbatim.
          out += source.slice(i);
          return out;
        }
        const close = `</${tag}>`;
        const end = source.indexOf(close, gt + 1);
        if (end === -1) {
          // Unterminated; skip to EOF.
          return out;
        }
        i = end + close.length;
        consumed = true;
        break;
      }
    }
    if (!consumed) {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

/**
 * Extract every quoted class attribute value's contents from a source
 * string (markup only — caller is expected to have stripped
 * `<script>` / `<style>` blocks first). Returns the raw class-string
 * payloads along with the 1-based line numbers where they appear.
 */
export function extractClassAttributes(markup) {
  const lines = markup.split('\n');
  const lineOffsets = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  function lineFor(index) {
    // Linear scan is fine; the files are small.
    for (let i = lineOffsets.length - 1; i >= 0; i -= 1) {
      if (index >= lineOffsets[i]) return i + 1;
    }
    return 1;
  }
  const out = [];
  for (const m of markup.matchAll(CLASS_ATTR_RE)) {
    out.push({ value: m[1], line: lineFor(m.index ?? 0) });
  }
  return out;
}

/**
 * Pull BEM-shaped class names out of a list of class-attribute payloads.
 * De-duplicates by class name, keeping the lowest line number seen so
 * the report points at the first occurrence.
 */
export function extractBemCandidates(attrs) {
  const seen = new Map();
  for (const { value, line } of attrs) {
    const tokens = value.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (BEM_BLOCK_ELEMENT.test(token) || BEM_MODIFIER.test(token)) {
        if (!seen.has(token) || seen.get(token) > line) {
          seen.set(token, line);
        }
      }
      BEM_BLOCK_ELEMENT.lastIndex = 0;
      BEM_MODIFIER.lastIndex = 0;
    }
  }
  return [...seen.entries()].map(([name, line]) => ({ name, line }));
}

/**
 * Collect class names declared by a `<style>` block in the same file.
 * The scan is intentionally tolerant — it pulls every `.<class-name>`
 * token out of every `<style>` block, regardless of the surrounding
 * selector context, because the goal is presence-of-rule rather than
 * full CSS parsing.
 */
export function collectColocatedStyleClasses(source) {
  const out = new Set();
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/g;
  const classRe = /\.([A-Za-z][\w-]*)/g;
  for (const m of source.matchAll(re)) {
    const body = m[1];
    for (const c of body.matchAll(classRe)) {
      out.add(c[1]);
    }
  }
  return out;
}

/**
 * Collect every class name referenced from a `<script>` block in the
 * same file. References we treat as "this class is a documented JS
 * hook":
 *   - `'.<class-name>'` (a CSS selector literal)
 *   - `'<class-name>'` when used inside `classList.add/remove/contains`
 *     or `querySelector(All)` — too noisy to gate precisely without a
 *     real JS parser, so we accept any string literal that appears
 *     inside a `<script>` block and contains the BEM-shape regex.
 */
export function collectScriptReferences(source) {
  const out = new Set();
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  for (const m of source.matchAll(re)) {
    const body = m[1];
    for (const s of body.matchAll(STRING_LITERAL_RE)) {
      const value = s[1];
      // Strip a leading dot (CSS-selector form) so the bare class name
      // can be matched against BEM candidates.
      const candidates = value.split(/[\s.,#>+~()[\]:]+/).filter(Boolean);
      for (const cand of candidates) {
        if (BEM_BLOCK_ELEMENT.test(cand) || BEM_MODIFIER.test(cand)) {
          out.add(cand);
        }
        BEM_BLOCK_ELEMENT.lastIndex = 0;
        BEM_MODIFIER.lastIndex = 0;
      }
    }
  }
  return out;
}

/**
 * Pull class names declared in `apps/web/src/styles/global.css`.
 * Cached on the resolver context.
 */
export function collectGlobalCssClasses(globalCssText) {
  const out = new Set();
  const classRe = /\.([A-Za-z][\w-]*)/g;
  for (const m of globalCssText.matchAll(classRe)) {
    out.add(m[1]);
  }
  return out;
}

/**
 * Pull class names declared by `cva()` calls inside the primitive
 * builder `.ts` files under `apps/web/src/components/ui/`. The scan
 * looks for any string literal inside a file whose name ends with
 * `.ts` (excluding `.test.ts`) under that directory and pulls
 * BEM-shaped tokens. This is intentionally generous: a `cva` variant
 * keyed by `foo__bar` will appear as a literal `'foo__bar'` regardless
 * of whether it's a key or a value, and the lint's purpose is to
 * confirm the name is owned by *some* primitive in the imported set.
 */
export function collectCvaClasses(primitivesRoot) {
  const out = new Set();
  if (!fs.existsSync(primitivesRoot)) return out;
  const files = walk(
    primitivesRoot,
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'),
  );
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(STRING_LITERAL_RE)) {
      const value = m[1];
      const candidates = value.split(/\s+/).filter(Boolean);
      for (const cand of candidates) {
        if (BEM_BLOCK_ELEMENT.test(cand) || BEM_MODIFIER.test(cand)) {
          out.add(cand);
        }
        BEM_BLOCK_ELEMENT.lastIndex = 0;
        BEM_MODIFIER.lastIndex = 0;
      }
    }
  }
  return out;
}

/**
 * Walk a directory tree, returning every file whose basename passes
 * the predicate. Skips `node_modules`, dot-directories, and common
 * generated dirs.
 */
export function walk(root, predicate, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    if (entry.name === 'dist' || entry.name === 'build') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, out);
    } else if (entry.isFile() && predicate(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Read the per-file allowlist. Missing file → empty allowlist.
 */
export function loadAllowlist(allowlistPath = ALLOWLIST_PATH) {
  if (!fs.existsSync(allowlistPath)) {
    return { entries: new Map() };
  }
  const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  const entries = new Map();
  for (const row of raw.entries ?? []) {
    entries.set(row.path, new Set(row.classes ?? []));
  }
  return { entries };
}

/**
 * Run the orphan-BEM scan against a single file's source. Returns the
 * list of orphan-BEM findings for the file (empty when none).
 *
 * `context` carries the resolver sets that are constant across all
 * files (`globalCssClasses`, `cvaClasses`) plus the per-file
 * allowlist entry (a `Set<string>` of tolerated class names, possibly
 * empty).
 */
export function findOrphans({ source, context, allowedForFile }) {
  const markup = stripScriptAndStyle(source);
  const attrs = extractClassAttributes(markup);
  const candidates = extractBemCandidates(attrs);
  const colocatedStyle = collectColocatedStyleClasses(source);
  const colocatedScript = collectScriptReferences(source);
  const orphans = [];
  for (const { name, line } of candidates) {
    if (colocatedStyle.has(name)) continue;
    if (context.globalCssClasses.has(name)) continue;
    if (context.cvaClasses.has(name)) continue;
    if (colocatedScript.has(name)) continue;
    if (allowedForFile.has(name)) continue;
    orphans.push({ class: name, line });
  }
  return orphans;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * Run the lint against the full `apps/web/src/` tree. Returns the
 * findings as an array of `{path, class, line}` records.
 */
export function runLint({
  webSrcRoot = WEB_SRC_ROOT,
  globalCssPath = GLOBAL_CSS_PATH,
  primitivesRoot = UI_PRIMITIVES_ROOT,
  allowlistPath = ALLOWLIST_PATH,
  repoRoot = REPO_ROOT,
} = {}) {
  const globalCssText = fs.existsSync(globalCssPath) ? fs.readFileSync(globalCssPath, 'utf8') : '';
  const context = {
    globalCssClasses: collectGlobalCssClasses(globalCssText),
    cvaClasses: collectCvaClasses(primitivesRoot),
  };
  const allowlist = loadAllowlist(allowlistPath);
  const files = walk(webSrcRoot, (name) => {
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return false;
    return name.endsWith('.astro') || name.endsWith('.tsx');
  });
  const findings = [];
  for (const file of files.sort()) {
    const rel = toPosix(path.relative(repoRoot, file));
    const allowedForFile = allowlist.entries.get(rel) ?? new Set();
    const source = fs.readFileSync(file, 'utf8');
    const orphans = findOrphans({ source, context, allowedForFile });
    for (const o of orphans) {
      findings.push({ path: rel, class: o.class, line: o.line });
    }
  }
  return findings;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/lint-orphan-bem.mjs [--json] [--help]

Walks apps/web/src/ and reports any class name matching the BEM
block-element (foo__bar) or modifier (foo--bar) shape that does not
resolve via one of:
  (a) a colocated <style> block in the same file,
  (b) a class rule in apps/web/src/styles/global.css,
  (c) a cva variant in an imported primitive under
      apps/web/src/components/ui/, or
  (d) a colocated <script> block reference (JS hook).

Per-file pre-existing orphans tolerated by the codifying Story
(#834) live in .lint-orphan-bem-allowlist.json at the repo root.

Flags:
  --json  Emit findings as JSON on stdout instead of the human report.
  --help  Show this message.

See docs/decisions/0007-ui-styling-convention.md for the binding rule.
`);
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const asJson = argv.includes('--json');
  const findings = runLint();
  if (asJson) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else if (findings.length > 0) {
    process.stderr.write(`lint-orphan-bem: ${findings.length} orphan BEM class name(s) found:\n`);
    for (const f of findings) {
      process.stderr.write(`  ${f.path}:${f.line}  ${f.class}\n`);
    }
    process.stderr.write(
      '\nSee docs/decisions/0007-ui-styling-convention.md for the resolver set.\n',
    );
    process.stderr.write(
      'Add the class to a <style> block, global.css, a cva variant, or — for a\n',
    );
    process.stderr.write(
      'pre-existing orphan — to .lint-orphan-bem-allowlist.json with rationale.\n',
    );
  }
  return findings.length === 0 ? 0 : 1;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('lint-orphan-bem.mjs');

if (isMain) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
