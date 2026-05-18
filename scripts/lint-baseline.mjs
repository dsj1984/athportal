#!/usr/bin/env node
// scripts/lint-baseline.mjs
//
// Lint baseline ratchet for the athportal monorepo.
//
// Runs Biome (`--reporter=json`) and ESLint (`--format=json`), aggregates
// per-file warning AND error counts across both reporters into the shared
// baseline envelope (`.agents/schemas/baselines/lint.schema.json`), and
// either:
//
//   --check    (default) compare the aggregate against `baselines/lint.json`
//              and exit non-zero when EITHER (a) any non-zero `errorCount`
//              appears in the current aggregate (the error contract is
//              zero — Story #373) OR (b) any per-file warning regression
//              or net-total warning increase shows up.
//   --update   write the aggregate to `baselines/lint.json` so the snapshot
//              becomes the new ceiling. Only the warning channel is
//              ratchet-absorbable via `--update`; non-zero errors must be
//              fixed in source — the gate refuses to record them as a new
//              floor.
//
// Envelope shape (per `.agents/schemas/baselines/lint.schema.json`):
//
//   {
//     "$schema": ".agents/schemas/baselines/lint.schema.json",
//     "kernelVersion": "1.0.0",
//     "generatedAt": "<iso-8601>",
//     "rollup": { "*": { "errorCount": <int>, "warningCount": <int> } },
//     "rows":    [ { "path": "<posix-rel>", "errorCount": <int>, "warningCount": <int> }, ... ]
//   }
//
// Harness consumption — when the @repo/baselines package resolves (it
// exposes its public surface via `./src/index.ts`, and resolves cleanly
// from a workspace consumer with a TS-aware loader such as Vitest), the
// script delegates read/write/compare/format primitives to it. The
// `.mjs` entrypoint cannot import the TypeScript surface directly, so a
// byte-compatible inline implementation is the production code path. The
// fallback mirrors the harness contract: sorted-key JSON, trailing LF,
// per-row warning ratchet, and a non-increasing net-total contract.
//
// The script uses `child_process.spawnSync` with `shell: false` and invokes
// each linter's Node entrypoint directly (`node_modules/<pkg>/bin/...`) so
// it behaves identically under PowerShell and bash. Row order and rollup
// keys are stable lex sorts so successive runs against an unchanged tree
// produce byte-identical JSON.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const BASELINE_PATH = path.join(REPO_ROOT, 'baselines', 'lint.json');
export const SCHEMA_POINTER = '.agents/schemas/baselines/lint.schema.json';
export const KERNEL_VERSION = '1.0.0';
const MAX_BUFFER = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Harness consumption (with inline fallback while the .ts surface is not
// loadable from a plain .mjs entrypoint — see file header).
// ---------------------------------------------------------------------------

let harness;
try {
  harness = await import('@repo/baselines');
} catch {
  harness = null;
}

function readBaseline(filePath) {
  if (harness?.readBaseline) {
    try {
      return harness.readBaseline(filePath, 'lint');
    } catch (err) {
      // Fall through to the inline reader so a malformed harness import
      // does not block the gate.
      process.stderr.write(`[lint-baseline] harness readBaseline failed: ${err.message}\n`);
    }
  }
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`[lint-baseline] failed to parse ${filePath}: ${err.message}`);
  }
}

function writeBaseline(filePath, envelope) {
  if (harness?.writeBaseline) {
    return harness.writeBaseline(filePath, envelope, 'lint');
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serialise(envelope), 'utf8');
}

// ---------------------------------------------------------------------------
// CLI argv parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
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
// We tally `severity === "warning"` and `severity === "error"` per file.
// ---------------------------------------------------------------------------

function collectBiomeCounts() {
  const r = runLinter('biome', 'node_modules/@biomejs/biome/bin/biome', [
    'check',
    '.',
    '--reporter=json',
  ]);
  // Biome exits non-zero when diagnostics exist — that is normal. We only
  // bail when there is no parseable JSON object at all.
  const jsonStr = extractFirstJsonObject(r.stdout);
  if (!jsonStr) {
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
    const sev = d?.severity;
    if (sev !== 'warning' && sev !== 'error') continue;
    let file = null;
    const loc = d.location;
    if (loc && typeof loc === 'object') {
      if (typeof loc.path === 'string') file = loc.path;
      else if (loc.path && typeof loc.path.file === 'string') file = loc.path.file;
    }
    if (!file) continue;
    const rel = toPosixRel(file);
    const entry = byFile.get(rel) ?? { errorCount: 0, warningCount: 0 };
    if (sev === 'error') entry.errorCount += 1;
    else entry.warningCount += 1;
    byFile.set(rel, entry);
  }
  return byFile;
}

// ---------------------------------------------------------------------------
// ESLint — `--format=json` emits a top-level array of
// `{ filePath, warningCount, errorCount, ... }`.
// ---------------------------------------------------------------------------

function collectEslintCounts() {
  const r = runLinter('eslint', 'node_modules/eslint/bin/eslint.js', ['.', '--format=json']);
  const jsonStr = extractFirstJsonArray(r.stdout);
  if (!jsonStr) {
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
    const err = Number(entry?.errorCount ?? 0);
    if ((!warn && !err) || !entry?.filePath) continue;
    const rel = toPosixRel(entry.filePath);
    const acc = byFile.get(rel) ?? { errorCount: 0, warningCount: 0 };
    acc.errorCount += err;
    acc.warningCount += warn;
    byFile.set(rel, acc);
  }
  return byFile;
}

// ---------------------------------------------------------------------------
// Aggregation + envelope construction
// ---------------------------------------------------------------------------

export function toPosixRel(absOrRel, root = REPO_ROOT) {
  let p = absOrRel;
  if (path.isAbsolute(p)) p = path.relative(root, p);
  // Strip any leading "./" so rows are consistent regardless of whether
  // the linter handed us a relative or absolute path.
  const posix = p.split(path.sep).join('/');
  return posix.startsWith('./') ? posix.slice(2) : posix;
}

// Merge a list of per-file count maps (each Map<path, {errorCount,
// warningCount}>) into a single sorted rows[] array plus a rollup
// {errorCount, warningCount}. Pure — caller provides the maps.
export function mergeCounts(...maps) {
  const merged = new Map();
  for (const m of maps) {
    for (const [file, counts] of m) {
      const acc = merged.get(file) ?? { errorCount: 0, warningCount: 0 };
      acc.errorCount += counts.errorCount;
      acc.warningCount += counts.warningCount;
      merged.set(file, acc);
    }
  }
  // Sort lex so JSON is diff-stable.
  const sorted = [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const rows = [];
  let errorCount = 0;
  let warningCount = 0;
  for (const [file, counts] of sorted) {
    rows.push({ path: file, errorCount: counts.errorCount, warningCount: counts.warningCount });
    errorCount += counts.errorCount;
    warningCount += counts.warningCount;
  }
  return { rollup: { errorCount, warningCount }, rows };
}

export function buildEnvelope({ rollup, rows }, now = new Date()) {
  return {
    $schema: SCHEMA_POINTER,
    kernelVersion: KERNEL_VERSION,
    generatedAt: now.toISOString(),
    rollup: { '*': { errorCount: rollup.errorCount, warningCount: rollup.warningCount } },
    rows,
  };
}

function aggregate(now = new Date()) {
  const biome = collectBiomeCounts();
  const eslint = collectEslintCounts();
  return buildEnvelope(mergeCounts(biome, eslint), now);
}

// ---------------------------------------------------------------------------
// Serialise (byte-stable, sorted keys, trailing newline). Mirrors the
// `@repo/baselines` `serialiseBaseline` contract so the fallback path
// produces byte-identical output to the harness.
// ---------------------------------------------------------------------------

function sortedReplacer(_key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = value[k];
    }
    return sorted;
  }
  return value;
}

export function serialise(envelope) {
  return `${JSON.stringify(envelope, sortedReplacer, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Tolerance comparison — two-channel gate (Story #373):
//
//   • Errors are non-negotiable. Any non-zero errorCount in the current
//     aggregate fails the gate, independent of the baseline. Errors that
//     the per-workspace `lint` scripts miss (because they only run against
//     `src/`) surface here; we cannot let them sit silently.
//
//   • Warnings ratchet downward. Per-file warning regressions and any
//     net-total warning increase fail the gate. Operators can intentionally
//     trade warning count by running `--update` after a fix.
//
// Pre-#373 behaviour gated on warnings only. The schema already carried
// errorCount for visibility; this change makes it load-bearing.
// ---------------------------------------------------------------------------

export function compareTolerance(baseline, current) {
  const baseByFile = new Map();
  for (const row of baseline?.rows ?? []) {
    baseByFile.set(row.path, {
      errorCount: Number(row.errorCount ?? 0),
      warningCount: Number(row.warningCount ?? 0),
    });
  }
  const warningRegressions = [];
  const errorFiles = [];
  for (const row of current.rows ?? []) {
    const prev = baseByFile.get(row.path) ?? { errorCount: 0, warningCount: 0 };
    const next = {
      errorCount: Number(row.errorCount ?? 0),
      warningCount: Number(row.warningCount ?? 0),
    };
    if (next.warningCount > prev.warningCount) {
      warningRegressions.push({
        file: row.path,
        prev: prev.warningCount,
        count: next.warningCount,
      });
    }
    if (next.errorCount > 0) {
      errorFiles.push({ file: row.path, count: next.errorCount });
    }
  }
  const baseWarn = Number(baseline?.rollup?.['*']?.warningCount ?? 0);
  const currWarn = Number(current?.rollup?.['*']?.warningCount ?? 0);
  const currErrors = Number(current?.rollup?.['*']?.errorCount ?? 0);
  return {
    warningRegressions,
    errorFiles,
    currErrors,
    baseWarn,
    currWarn,
    warnDelta: currWarn - baseWarn,
  };
}

export function formatRejectionMessage({
  warningRegressions,
  errorFiles,
  currErrors,
  baseWarn,
  currWarn,
  warnDelta,
}) {
  const lines = ['[lint-baseline] ❌ baseline regression detected'];
  if (currErrors > 0) {
    lines.push(`  errors: ${currErrors} (blocking — error contract is zero)`);
    for (const e of errorFiles) {
      lines.push(`    ${e.file}: ${e.count} error${e.count === 1 ? '' : 's'}`);
    }
  }
  lines.push(
    `  totalWarnings: baseline=${baseWarn} current=${currWarn} (Δ=${warnDelta >= 0 ? '+' : ''}${warnDelta})`,
  );
  if (warningRegressions.length > 0) {
    lines.push('  files that gained warnings:');
    for (const r of warningRegressions) {
      lines.push(`    ${r.file}: ${r.prev} → ${r.count} (+${r.count - r.prev})`);
    }
  }
  lines.push(
    '  Fix the errors and any new warnings, or — if a warning regression is intentional — re-run `pnpm run lint:baseline:update`. Errors cannot be absorbed via update.',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function modeUpdate(now = new Date()) {
  const envelope = aggregate(now);
  const errors = envelope.rollup['*'].errorCount;
  if (errors > 0) {
    // Refuse to record errors as a new floor. The error contract is zero
    // (Story #373) — absorbing errors via `--update` would silently make
    // the gate green again. Operator must fix the errors first.
    process.stderr.write(
      `[lint-baseline] ❌ refused to update — current aggregate has ${errors} error${errors === 1 ? '' : 's'}. ` +
        `Errors cannot be absorbed into the baseline. Fix them in source, then re-run --update.\n`,
    );
    for (const row of envelope.rows) {
      if (row.errorCount > 0) {
        process.stderr.write(
          `  ${row.path}: ${row.errorCount} error${row.errorCount === 1 ? '' : 's'}\n`,
        );
      }
    }
    return 1;
  }
  writeBaseline(BASELINE_PATH, envelope);
  process.stdout.write(
    `[lint-baseline] wrote ${path.relative(REPO_ROOT, BASELINE_PATH).split(path.sep).join('/')} — errors=0, totalWarnings=${envelope.rollup['*'].warningCount}, files=${envelope.rows.length}\n`,
  );
  return 0;
}

function modeCheck(now = new Date()) {
  const current = aggregate(now);
  const baseline = readBaseline(BASELINE_PATH);
  if (!baseline) {
    process.stderr.write(
      '[lint-baseline] baselines/lint.json missing — run `pnpm run lint:baseline:update` to create it.\n',
    );
    return 1;
  }
  const result = compareTolerance(baseline, current);
  const clean =
    result.currErrors === 0 && result.warningRegressions.length === 0 && result.warnDelta <= 0;
  if (clean) {
    process.stdout.write(
      `[lint-baseline] ok — errors=0, totalWarnings=${result.currWarn} (baseline ${result.baseWarn})\n`,
    );
    return 0;
  }
  process.stderr.write(`${formatRejectionMessage(result)}\n`);
  return 1;
}

function modeHelp() {
  process.stdout.write(
    `Usage: node scripts/lint-baseline.mjs [--check | --update]\n\n` +
      `  --check    (default) diff aggregate against baselines/lint.json\n` +
      `  --update   rewrite baselines/lint.json from the current tree\n`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
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
}
