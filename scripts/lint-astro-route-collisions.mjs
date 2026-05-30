#!/usr/bin/env node
// scripts/lint-astro-route-collisions.mjs
//
// Guard against Astro route-collision regressions (Story #1068).
//
// Astro registers every file in `src/pages/` as a route handler unless
// the filename starts with `_` or the directory starts with `_`. When
// two files resolve to the same path (e.g. `dashboard.ts` and
// `dashboard.astro`) Astro emits a boot-time warning today and will
// hard-error in a future Astro major.
//
// This script walks `apps/web/src/pages/` and fails (exit 1) when it
// finds any non-underscore-prefixed `.ts` / `.tsx` file whose stem
// matches an `.astro` file in the same directory. Pure Node ESM — no
// build step, no runtime dependency.
//
// Usage:
//   node scripts/lint-astro-route-collisions.mjs
//   node scripts/lint-astro-route-collisions.mjs --pages-dir <path>
//
// Exit codes:
//   0 — no collisions detected.
//   1 — one or more collisions found (list printed to stderr).
//   2 — usage / bootstrap error (pages directory not found).

import { readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolvePath(__filename, '../../');

function parseArgs() {
  const args = process.argv.slice(2);
  let pagesDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pages-dir' && args[i + 1]) {
      pagesDir = args[++i];
    }
    if (args[i] === '--help') {
      process.stdout.write(
        'Usage: node scripts/lint-astro-route-collisions.mjs [--pages-dir <path>]\n',
      );
      process.exit(0);
    }
  }
  return {
    pagesDir: pagesDir ? resolvePath(pagesDir) : join(repoRoot, 'apps', 'web', 'src', 'pages'),
  };
}

/**
 * Recursively walk `dir`, collecting every non-`_`-prefixed `.ts` /
 * `.tsx` file whose stem also has a sibling `.astro` file.
 *
 * Astro ignores:
 *   - Files whose name starts with `_`.
 *   - Directories whose name starts with `_`.
 * So we mirror those rules here.
 *
 * @param {string} dir Absolute path to the pages directory.
 * @returns {string[]} Absolute paths of colliding `.ts` / `.tsx` files.
 */
function findCollisions(dir) {
  let collisions = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return collisions;
  }

  // Build a Set of .astro stems for fast lookup.
  const astroStems = new Set(
    entries
      .filter((name) => name.endsWith('.astro'))
      .map((name) => name.slice(0, -'.astro'.length)),
  );

  for (const name of entries) {
    const fullPath = join(dir, name);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      // Skip underscore-prefixed directories — Astro ignores them.
      if (name.startsWith('_')) continue;
      collisions = collisions.concat(findCollisions(fullPath));
      continue;
    }

    const ext = extname(name);
    if (ext !== '.ts' && ext !== '.tsx') continue;
    // Skip underscore-prefixed files — Astro ignores them.
    if (name.startsWith('_')) continue;

    const stem = basename(name, ext);
    if (astroStems.has(stem)) {
      collisions.push(fullPath);
    }
  }

  return collisions;
}

function main() {
  const { pagesDir } = parseArgs();

  let pagesExists = false;
  try {
    pagesExists = statSync(pagesDir).isDirectory();
  } catch {
    // fall through
  }

  if (!pagesExists) {
    process.stderr.write(
      `[lint-astro-route-collisions] ❌ pages directory not found: ${pagesDir}\n`,
    );
    process.exit(2);
  }

  const collisions = findCollisions(pagesDir);

  if (collisions.length === 0) {
    process.stdout.write('[lint-astro-route-collisions] ✅ No route collisions detected.\n');
    process.exit(0);
  }

  process.stderr.write(
    `[lint-astro-route-collisions] ❌ ${collisions.length} route collision(s) found.\n` +
      `Each file below has both a .ts/.tsx and an .astro sibling that resolve to the same Astro route.\n` +
      `Astro warns today and will hard-error in a future major. Remove or rename the .ts/.tsx file\n` +
      `(prefix it with \`_\` so Astro ignores it as a route handler — see Story #1068):\n\n` +
      collisions.map((p) => `  ${relative(repoRoot, p)}`).join('\n') +
      '\n',
  );
  process.exit(1);
}

main();
