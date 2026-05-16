#!/usr/bin/env node
// scripts/check-no-any.mjs
//
// Fails (exit 1) if `: any` or `@ts-ignore` appears in any TypeScript source
// file under apps/**/src or packages/**/src. Exits 0 when those directories
// do not yet exist (bootstrap-friendly: workspaces and their src/ trees land
// in later Stories).
//
// Scope:
//   - Scans only apps/**/src and packages/**/src.
//   - Skips node_modules entirely and ignores ambient declaration files
//     (*.d.ts) which routinely re-export `any` from upstream typings.
//   - Inspects only .ts / .tsx / .mts / .cts files.
//
// Forbidden patterns:
//   - `: any` annotations (with word-boundary on the trailing side so
//     `: anything` / `: anyOf` are not matched).
//   - `@ts-ignore` directives in any form.
//
// Usage:
//   node scripts/check-no-any.mjs
//
// Story #99 — Strict TypeScript baseline with shared tsconfig.base.json.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const ROOTS = ['apps', 'packages'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

// `: any` followed by a non-word character (or end of line / end of file).
// Avoids false positives on `: anything`, `: anyOf`, etc.
const ANY_PATTERN = /:\s*any\b/;
const TS_IGNORE_PATTERN = /@ts-ignore\b/;

/**
 * @returns {Promise<boolean>}
 */
async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * Walks workspaceRoot looking for `src/` directories one level deep
 * (apps/<workspace>/src, packages/<workspace>/src). Returns the list of
 * src directories that actually exist.
 *
 * @param {string} workspaceRoot Absolute path to apps/ or packages/.
 * @returns {Promise<string[]>}
 */
async function findSrcDirs(workspaceRoot) {
  if (!(await pathExists(workspaceRoot))) {
    return [];
  }
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  const srcDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === 'node_modules') {
      continue;
    }
    const candidate = join(workspaceRoot, entry.name, 'src');
    if (await pathExists(candidate)) {
      srcDirs.push(candidate);
    }
  }
  return srcDirs;
}

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.endsWith('.d.ts')) {
      continue;
    }
    const dotIndex = entry.name.lastIndexOf('.');
    if (dotIndex === -1) {
      continue;
    }
    const ext = entry.name.slice(dotIndex);
    if (!SOURCE_EXTENSIONS.has(ext)) {
      continue;
    }
    yield full;
  }
}

/**
 * @param {string} filePath
 * @returns {Promise<Array<{ file: string, line: number, text: string, pattern: string }>>}
 */
async function scanFile(filePath) {
  const contents = await readFile(filePath, 'utf8');
  const lines = contents.split(/\r?\n/);
  const violations = [];
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    if (text === undefined) {
      continue;
    }
    if (ANY_PATTERN.test(text)) {
      violations.push({
        file: filePath,
        line: i + 1,
        text: text.trim(),
        pattern: ': any',
      });
    }
    if (TS_IGNORE_PATTERN.test(text)) {
      violations.push({
        file: filePath,
        line: i + 1,
        text: text.trim(),
        pattern: '@ts-ignore',
      });
    }
  }
  return violations;
}

async function main() {
  const allSrcDirs = [];
  for (const root of ROOTS) {
    const absRoot = join(REPO_ROOT, root);
    const dirs = await findSrcDirs(absRoot);
    allSrcDirs.push(...dirs);
  }

  if (allSrcDirs.length === 0) {
    console.log(
      'check-no-any: no apps/**/src or packages/**/src directories present yet; skipping (exit 0).',
    );
    return;
  }

  /** @type {Array<{ file: string, line: number, text: string, pattern: string }>} */
  const violations = [];
  let scannedFiles = 0;
  for (const srcDir of allSrcDirs) {
    for await (const file of walk(srcDir)) {
      scannedFiles += 1;
      const found = await scanFile(file);
      violations.push(...found);
    }
  }

  if (violations.length > 0) {
    console.error(
      `check-no-any: found ${violations.length} forbidden pattern occurrence(s) across ${scannedFiles} scanned file(s):`,
    );
    for (const v of violations) {
      const rel = relative(REPO_ROOT, v.file).split(sep).join('/');
      console.error(`  ${rel}:${v.line}  [${v.pattern}]  ${v.text}`);
    }
    console.error(
      '\nThe strict-TS baseline forbids `: any` annotations and `@ts-ignore` directives.',
    );
    console.error(
      'Replace `any` with a real type (or `unknown` + narrowing) and remove ignore directives.',
    );
    process.exit(1);
  }

  console.log(
    `check-no-any: OK — scanned ${scannedFiles} file(s) across ${allSrcDirs.length} src tree(s); no forbidden patterns found.`,
  );
}

main().catch((err) => {
  console.error('check-no-any: unexpected error');
  console.error(err);
  process.exit(2);
});
