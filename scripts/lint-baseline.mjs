#!/usr/bin/env node
// scripts/lint-baseline.mjs
//
// Lint baseline ratchet for the athportal monorepo.
//
// Runs Biome (`--reporter=json`) and ESLint (`--format=json`), aggregates
// per-file *warning* counts across both reporters, and either:
//
//   --check    (default) diff the aggregate against `.lint-baseline.json`
//              and exit non-zero on any per-file regression or net total
//              increase.
//   --update   write the aggregate to `.lint-baseline.json` so the snapshot
//              becomes the new ceiling.
//
// The script uses `child_process.spawnSync` with `shell: false` and invokes
// each linter's Node entrypoint directly (`node_modules/<pkg>/bin/...`) so
// it behaves identically under PowerShell and bash. `byFile` keys are
// sorted lexicographically before serialization so successive runs against
// an unchanged tree produce byte-identical JSON (the diff-stability AC for
// Task #101).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(REPO_ROOT, '.lint-baseline.json');
const MAX_BUFFER = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// CLI argv parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let mode = 'check';
  for (const a of argv.slice(2)) {
    if (a === '--check') mode = 'check';
    else if (a === '--update') mode = 'update';
    else if (a === '--help' || a === '-h') mode = 'help';
    else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return { mode };
}

// ---------------------------------------------------------------------------
// Linter invocations
// ---------------------------------------------------------------------------

function runLinter(label, nodeEntry, args) {
  const entryAbs = path.join(REPO_ROOT, nodeEntry);
  if (!fs.existsSync(entryAbs)) {
    throw new Error(`[${label}] entrypoint missing at ${nodeEntry}. Did dependencies install?`);
  }
  const result = spawnSync(process.execPath, [entryAbs, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    shell: false,
  });
  if (result.error) {
    throw new Error(`[${label}] spawn failed: ${result.error.message}`);
  }
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

// Extract the first top-level JSON object from a stdout stream that may carry
// a banner or trailing human-readable footer (Biome's `--json` reporter does
// this).
function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, k + 1);
    }
  }
  return null;
}

// Extract the first top-level JSON array (ESLint's `--format=json` output).
function extractFirstJsonArray(text) {
  const start = text.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, k + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Biome — `--reporter=json` emits a single top-level object with
// `diagnostics: [{ severity, location: { path: { file } } | path:str }]`.
// Severity is one of "error" | "warning" | "information" | "hint".
// We tally only `severity === "warning"`.
// ---------------------------------------------------------------------------

function collectBiomeWarnings() {
  const r = runLinter('biome', 'node_modules/@biomejs/biome/bin/biome', [
    'check',
    '.',
    '--reporter=json',
  ]);
  // Biome exits non-zero when diagnostics exist — that is normal. We only
  // bail when there is no parseable JSON object at all.
  const jsonStr = extractFirstJsonObject(r.stdout);
  if (!jsonStr) {
    // No JSON means a real invocation failure (e.g. config error).
    process.stderr.write(`[biome] stdout: ${r.stdout.slice(0, 500)}\n`);
    process.stderr.write(`[biome] stderr: ${r.stderr.slice(0, 500)}\n`);
    throw new Error('[biome] failed to locate JSON payload in reporter output');
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`[biome] JSON.parse failed: ${err.message}`);
  }
  const byFile = new Map();
  for (const d of parsed.diagnostics ?? []) {
    if (d?.severity !== 'warning') continue;
    let file = null;
    const loc = d.location;
    if (loc && typeof loc === 'object') {
      if (typeof loc.path === 'string') file = loc.path;
      else if (loc.path && typeof loc.path.file === 'string') file = loc.path.file;
    }
    if (!file) continue;
    const rel = toPosixRel(file);
    byFile.set(rel, (byFile.get(rel) ?? 0) + 1);
  }
  return byFile;
}

// ---------------------------------------------------------------------------
// ESLint — `--format=json` emits a top-level array of
// `{ filePath, warningCount, ... }`.
// ---------------------------------------------------------------------------

function collectEslintWarnings() {
  const r = runLinter('eslint', 'node_modules/eslint/bin/eslint.js', ['.', '--format=json']);
  const jsonStr = extractFirstJsonArray(r.stdout);
  if (!jsonStr) {
    // ESLint with zero files matched returns `[]` — extractFirstJsonArray
    // will still find it. If it truly emitted no JSON, that's a real failure.
    process.stderr.write(`[eslint] stdout: ${r.stdout.slice(0, 500)}\n`);
    process.stderr.write(`[eslint] stderr: ${r.stderr.slice(0, 500)}\n`);
    throw new Error('[eslint] failed to locate JSON payload in reporter output');
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`[eslint] JSON.parse failed: ${err.message}`);
  }
  const byFile = new Map();
  for (const entry of parsed) {
    const warn = Number(entry?.warningCount ?? 0);
    if (!warn || !entry?.filePath) continue;
    const rel = toPosixRel(entry.filePath);
    byFile.set(rel, (byFile.get(rel) ?? 0) + warn);
  }
  return byFile;
}

// ---------------------------------------------------------------------------
// Aggregation + IO
// ---------------------------------------------------------------------------

function toPosixRel(absOrRel) {
  let p = absOrRel;
  if (path.isAbsolute(p)) p = path.relative(REPO_ROOT, p);
  return p.split(path.sep).join('/');
}

function aggregate() {
  const biome = collectBiomeWarnings();
  const eslint = collectEslintWarnings();
  const merged = new Map();
  for (const [f, n] of biome) merged.set(f, (merged.get(f) ?? 0) + n);
  for (const [f, n] of eslint) merged.set(f, (merged.get(f) ?? 0) + n);
  // Sort lex so JSON is diff-stable.
  const sorted = [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const byFile = {};
  let totalWarnings = 0;
  for (const [f, n] of sorted) {
    byFile[f] = n;
    totalWarnings += n;
  }
  return { totalWarnings, byFile };
}

function serialize(snapshot) {
  // Trailing newline keeps the file POSIX-friendly and stable across editors.
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse .lint-baseline.json: ${err.message}`);
  }
}

function writeBaseline(snapshot) {
  fs.writeFileSync(BASELINE_PATH, serialize(snapshot), 'utf8');
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function modeUpdate() {
  const snapshot = aggregate();
  writeBaseline(snapshot);
  process.stdout.write(
    `[lint-baseline] wrote .lint-baseline.json — totalWarnings=${snapshot.totalWarnings}, files=${Object.keys(snapshot.byFile).length}\n`,
  );
  return 0;
}

function modeCheck() {
  const current = aggregate();
  const baseline = loadBaseline();
  if (!baseline) {
    process.stderr.write(
      '[lint-baseline] .lint-baseline.json missing — run `node scripts/lint-baseline.mjs --update` to create it.\n',
    );
    return 1;
  }
  const baseByFile = baseline.byFile ?? {};
  const baseTotal = Number(baseline.totalWarnings ?? 0);

  const regressions = [];
  for (const [file, count] of Object.entries(current.byFile)) {
    const prev = Number(baseByFile[file] ?? 0);
    if (count > prev) regressions.push({ file, prev, count });
  }

  const totalDelta = current.totalWarnings - baseTotal;

  if (regressions.length === 0 && totalDelta <= 0) {
    process.stdout.write(
      `[lint-baseline] ok — totalWarnings=${current.totalWarnings} (baseline ${baseTotal})\n`,
    );
    return 0;
  }

  process.stderr.write('[lint-baseline] ❌ baseline regression detected\n');
  process.stderr.write(
    `  totalWarnings: baseline=${baseTotal} current=${current.totalWarnings} (Δ=${totalDelta >= 0 ? '+' : ''}${totalDelta})\n`,
  );
  if (regressions.length > 0) {
    process.stderr.write('  files that gained warnings:\n');
    for (const r of regressions) {
      process.stderr.write(`    ${r.file}: ${r.prev} → ${r.count} (+${r.count - r.prev})\n`);
    }
  }
  process.stderr.write(
    '  Fix the new warnings, or — if the regression is intentional — re-run `node scripts/lint-baseline.mjs --update`.\n',
  );
  return 1;
}

function modeHelp() {
  process.stdout.write(
    `Usage: node scripts/lint-baseline.mjs [--check | --update]\n\n` +
      `  --check    (default) diff aggregate against .lint-baseline.json\n` +
      `  --update   rewrite .lint-baseline.json from the current tree\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const { mode } = parseArgs(process.argv);
let exitCode = 0;
try {
  if (mode === 'update') exitCode = modeUpdate();
  else if (mode === 'check') exitCode = modeCheck();
  else exitCode = modeHelp();
} catch (err) {
  process.stderr.write(`[lint-baseline] ${err.message}\n`);
  exitCode = 1;
}
process.exit(exitCode);
