#!/usr/bin/env node
// scripts/verify-crap-mi-bites-tests.mjs
//
// Gate-bite verification for the CRAP/MI quality gate's *test-code* scope
// (Epic #1001 — "Bring test files into CRAP + Maintainability measurement";
// Story #1043).
//
// PURPOSE
// -------
// After Story #1040 dropped `**/*.test.ts` from the maintainability /
// CRAP `ignoreGlobs`, newly-introduced over-complex *test* code must be
// rejected by the quality gate exactly the way over-complex *production*
// code already is. This script proves that empirically and repeatably:
// it manufactures a synthetic, deliberately over-complex `*.test.ts`
// file under a MEASURED workspace path, drives the gate red, confirms it
// is green again once the file is gone, and ALWAYS removes every artifact
// it created (try/finally) so nothing is left committed in the tree.
//
// WHY THE MAINTAINABILITY GATE IS THE ANCHOR
// ------------------------------------------
// The Maintainability Index (MI) is computed from source alone — no
// coverage instrumentation is required. A file engineered to score
// MI < 70 therefore drops `rollup['*'].min` below the configured floor
// (`delivery.quality.gates.maintainability.floors['*'].min === 70` in
// `.agentrc.json`) and makes
//   node .agents/scripts/check-baselines.js --gate maintainability
// exit non-zero. That is the reliable, deterministic demonstrator.
//
// CRAP, by contrast, needs V8 coverage instrumentation; spec/test files
// are typically not instrumented, so a synthetic `.test.ts` may not
// produce a CRAP row at all. The Story's acceptance ("the CRAP/MI gate
// fails") is satisfied by the MI gate going red, so this script anchors
// the proof on maintainability and does not depend on CRAP coverage.
//
// HOW THE GATE READS "HEAD"
// -------------------------
// `check-baselines.js --gate maintainability` compares the committed
// `baselines/maintainability.json` (the "head" set) against the same
// file at the base ref (`main`), then floor-checks every head row. The
// head MI rows come from the committed baseline, NOT from a live scan of
// the working tree. So to surface the synthetic file in the gate we must
// regenerate the baseline (`update-maintainability-baseline.js
// --full-scope`, which walks the configured target dirs on disk) while
// the synthetic file is present. We snapshot and restore the baseline so
// the repo's committed baseline is never mutated.
//
// EXIT CONTRACT
// -------------
//   0  — red-with-probe AND green-without-probe both confirmed.
//   1  — the gate did NOT go red with the probe present, the gate did NOT
//         return to green after cleanup, or any setup/teardown step failed.
//
// The script is idempotent and leaves a clean working tree on every exit
// path.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// A MEASURED path: under `packages/`, matching `*.test.ts`, which is NO
// LONGER ignored after Story #1040. It is NOT a `fixtures/` or `.d.ts`
// path (those remain excluded), so the maintainability scorer will score
// it. The `__crap_mi_probe__` infix makes accidental leftovers obvious.
const PROBE_REL = 'packages/shared/src/__crap_mi_probe__.test.ts';
const PROBE_ABS = path.join(REPO_ROOT, PROBE_REL);

const BASELINE_REL = 'baselines/maintainability.json';
const BASELINE_ABS = path.join(REPO_ROOT, BASELINE_REL);

const MI_FLOOR = 70; // mirrors .agentrc.json maintainability floor

/**
 * Run a command synchronously from the repo root and capture its result.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: false,
  });
  return {
    status: res.status ?? (res.error ? 1 : 0),
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

/**
 * Run the maintainability gate. Returns the process exit code; 0 means
 * green (pass), non-zero means red (a floor breach or regression).
 *
 * @returns {number}
 */
function runMaintainabilityGate() {
  const res = run('node', [
    '.agents/scripts/check-baselines.js',
    '--gate',
    'maintainability',
    '--no-friction',
  ]);
  return res.status;
}

/**
 * Regenerate the maintainability baseline across every configured target
 * directory (filesystem walk), so the on-disk synthetic file is scored
 * into a fresh row.
 *
 * @returns {number}
 */
function regenerateBaselineFullScope() {
  const res = run('node', ['.agents/scripts/update-maintainability-baseline.js', '--full-scope']);
  if (res.status !== 0) {
    process.stderr.write(res.stdout + res.stderr);
  }
  return res.status;
}

/**
 * Compose a synthetic `.test.ts` body engineered to score MI < 70:
 * one enormous function body with high cyclomatic complexity (dozens of
 * nested branches, loops, and switch arms) and a large Halstead volume
 * (many distinct operators/operands), plus sheer length.
 *
 * @returns {string}
 */
function buildOverComplexTestSource() {
  const lines = [
    '// AUTO-GENERATED by scripts/verify-crap-mi-bites-tests.mjs — DO NOT COMMIT.',
    '// Synthetic over-complex test fixture used only to prove the MI gate',
    '// rejects over-complex test code. Removed automatically after the run.',
    'import { describe, expect, it } from "vitest";',
    '',
    'describe("crap/mi probe — intentionally over-complex", () => {',
    '  it("exercises a deliberately convoluted code path", () => {',
    '    let acc = 0;',
    '    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];',
  ];

  // 60 nested-branch blocks: each adds cyclomatic edges (if/&&/||/for/
  // while/switch) and many distinct operators/operands → high V & CC,
  // low MI.
  for (let i = 0; i < 60; i++) {
    const d = i % 10;
    lines.push(`    if (data[${d}] > ${i} && acc < ${i * 2} || acc > ${i + 3}) {`);
    lines.push(`      for (let k${i} = 0; k${i} < ${i + 1}; k${i}++) {`);
    lines.push(`        acc = acc + data[${d}] * ${i} - ${i + 1} + (acc % ${i + 2});`);
    lines.push(`        while (acc > ${i * 5} && k${i} < ${i}) { acc = acc - ${i + 1}; k${i}++; }`);
    lines.push(
      `        switch (acc % 3) { case 0: acc += ${i}; break; case 1: acc -= ${i}; break; default: acc *= 2; }`,
    );
    lines.push('      }');
    lines.push('    } else {');
    lines.push(`      acc = acc - ${i} + (data[${d}] ? ${i} : ${i + 1});`);
    lines.push('    }');
  }

  lines.push('    expect(typeof acc).toBe("number");');
  lines.push('  });');
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/**
 * Read the MI assigned to the probe row in the (regenerated) baseline,
 * or `null` if no probe row exists.
 *
 * @returns {number | null}
 */
function probeMiFromBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_ABS, 'utf8'));
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const probe = rows.find((r) => String(r.path).includes('__crap_mi_probe__'));
    return probe ? Number(probe.mi) : null;
  } catch {
    return null;
  }
}

function fail(message) {
  process.stderr.write(`\n❌ ${message}\n`);
  process.exitCode = 1;
}

function info(message) {
  process.stdout.write(`${message}\n`);
}

function main() {
  info('▶ verify-crap-mi-bites-tests: proving the MI gate bites over-complex test code');

  // Sanity: never run if a probe artifact already lingers — that would
  // mean a previous run did not clean up, and we must not mask it.
  if (existsSync(PROBE_ABS)) {
    fail(`A synthetic probe already exists at ${PROBE_REL}. Remove it before re-running.`);
    return;
  }

  // Snapshot the committed baseline so the gate's "head" set is never
  // permanently mutated by our full-scope regeneration.
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'crap-mi-probe-'));
  const baselineBackup = path.join(tmpDir, 'maintainability.json');
  let baselineSnapshotted = false;

  try {
    writeFileSync(baselineBackup, readFileSync(BASELINE_ABS));
    baselineSnapshotted = true;

    // Pre-flight: the gate must be GREEN before we contaminate anything.
    const preExit = runMaintainabilityGate();
    if (preExit !== 0) {
      fail(
        `Pre-flight maintainability gate is already red (exit ${preExit}). ` +
          'Cannot attribute a red result to the probe; aborting.',
      );
      return;
    }
    info('  ✓ pre-flight: maintainability gate is green');

    // 1) Plant the synthetic over-complex test file at a measured path.
    writeFileSync(PROBE_ABS, buildOverComplexTestSource(), 'utf8');
    info(`  ✓ planted synthetic over-complex test at ${PROBE_REL}`);

    // 2) Regenerate the baseline so the probe is scored into a head row.
    const regenExit = regenerateBaselineFullScope();
    if (regenExit !== 0) {
      fail(`Baseline regeneration failed (exit ${regenExit}).`);
      return;
    }

    const probeMi = probeMiFromBaseline();
    if (probeMi === null) {
      fail(
        'Probe file was not scored into the maintainability baseline — ' +
          'its path may have fallen outside the measured scope.',
      );
      return;
    }
    info(`  ✓ probe scored MI=${probeMi} (floor=${MI_FLOOR})`);
    if (probeMi >= MI_FLOOR) {
      fail(
        `Probe MI ${probeMi} is at or above the floor ${MI_FLOOR}; ` +
          'it is not over-complex enough to drive the gate red.',
      );
      return;
    }

    // 3) The gate must now be RED (floor breach from the probe row).
    const redExit = runMaintainabilityGate();
    if (redExit === 0) {
      fail(
        'Maintainability gate stayed green with an MI<70 probe present — ' +
          'the gate did NOT bite over-complex test code.',
      );
      return;
    }
    info(`  ✓ gate went RED with probe present (exit ${redExit})`);

    // 4) Restore the baseline and remove the probe; the gate must be
    //    GREEN again, proving the red result was caused by the probe.
    writeFileSync(BASELINE_ABS, readFileSync(baselineBackup));
    rmSync(PROBE_ABS, { force: true });

    const greenExit = runMaintainabilityGate();
    if (greenExit !== 0) {
      fail(`Maintainability gate did not return to green after cleanup ` + `(exit ${greenExit}).`);
      return;
    }
    info(`  ✓ gate returned to GREEN after cleanup (exit ${greenExit})`);

    info(
      '\n✅ PROVED: the CRAP/MI gate rejects newly-introduced over-complex ' +
        'test code (red-with-probe, green-without).',
    );
    process.exitCode = 0;
  } finally {
    // ALWAYS clean up: remove the synthetic file and restore the baseline
    // verbatim, regardless of how we exited the try block.
    if (existsSync(PROBE_ABS)) {
      rmSync(PROBE_ABS, { force: true });
    }
    if (baselineSnapshotted) {
      try {
        writeFileSync(BASELINE_ABS, readFileSync(baselineBackup));
      } catch (err) {
        process.stderr.write(`\n⚠️ failed to restore ${BASELINE_REL}: ${err?.message ?? err}\n`);
        process.exitCode = 1;
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
