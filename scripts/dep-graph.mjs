#!/usr/bin/env node
// scripts/dep-graph.mjs
//
// Developer-only helper for ad-hoc dependency-graph inspection.
// Runs dependency-cruiser with `--output-type dot` and writes the result
// to `temp/dep-graph.dot`. Pipe through Graphviz (`dot -Tsvg`) locally to
// render. Not wired into CI.
//
// Usage: `pnpm run lint:deps:graph`

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'temp');
const OUT_FILE = path.join(OUT_DIR, 'dep-graph.dot');

mkdirSync(OUT_DIR, { recursive: true });

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'depcruise',
    'apps',
    'packages',
    '--config',
    '.dependency-cruiser.cjs',
    '--output-type',
    'dot',
  ],
  { cwd: REPO_ROOT, encoding: 'utf8', shell: process.platform === 'win32' },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr ?? '');
  process.exit(result.status ?? 1);
}

writeFileSync(OUT_FILE, result.stdout, 'utf8');
process.stdout.write(`wrote ${path.relative(REPO_ROOT, OUT_FILE)}\n`);
