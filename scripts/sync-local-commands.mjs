#!/usr/bin/env node

/**
 * Project-local complement to `.agents/scripts/sync-claude-commands.js`.
 *
 * Syncs `workflows-local/*.md` → `.claude/commands/` so the project can
 * ship slash commands that are *not* part of the upstream `.agents/`
 * submodule (mandrel). The mandrel-owned sync runs first and may delete
 * stray files in `.claude/commands/`; this script runs after it and is
 * the only writer of project-local commands.
 *
 * Naming-collision policy: if a `workflows-local/foo.md` collides with a
 * file the framework sync already produced, the local copy WINS and a
 * warning is emitted — the project deliberately overrides a framework
 * workflow only when it has good reason to.
 *
 * Wired into `package.json` `prepare` and `sync:commands` so a fresh
 * install (or a deliberate sync) hydrates both sources.
 *
 * Citation: Story #794 (the /run-qa slash command) — the submodule
 * constraint forbids editing `.agents/workflows/` directly, so the
 * project keeps its own surface here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SRC_DIR = path.join(PROJECT_ROOT, 'workflows-local');
const DEST_DIR = path.join(PROJECT_ROOT, '.claude', 'commands');

const HEADER =
  '<!-- AUTO-GENERATED — do not edit. Source of truth: workflows-local/ (project-local) -->\n<!-- Re-run: pnpm run sync:commands -->\n\n';

// Idempotent: nothing to do if the project hasn't authored any local
// workflows yet. (Keeps the script safe for greenfield clones.)
if (!fs.existsSync(SRC_DIR)) {
  process.exit(0);
}

fs.mkdirSync(DEST_DIR, { recursive: true });

const sources = fs
  .readdirSync(SRC_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
  .map((entry) => entry.name);

let synced = 0;
for (const file of sources) {
  const srcPath = path.join(SRC_DIR, file);
  const destPath = path.join(DEST_DIR, file);
  const content = fs.readFileSync(srcPath, 'utf8');
  const target = HEADER + content;

  let existed = false;
  try {
    const existing = fs.readFileSync(destPath, 'utf8');
    existed = true;
    if (existing === target) continue;
    // Override notice: a framework workflow with the same name was just
    // written by the upstream sync. Surface that so reviewers don't
    // wonder where the divergence came from.
    if (!existing.startsWith(HEADER)) {
      console.warn(`  warn     ${file} — overriding framework command with project-local copy`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  fs.writeFileSync(destPath, target, 'utf8');
  synced++;
  console.log(`  synced   ${file}${existed ? ' (project-local)' : ''}`);
}

console.log(
  `\n✔ ${synced} project-local file(s) synced, ${sources.length} total in workflows-local/`,
);
