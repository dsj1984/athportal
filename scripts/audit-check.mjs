#!/usr/bin/env node
// scripts/audit-check.mjs
//
// Supply-chain CVE gate per ADR-011.
//
// Runs `pnpm audit --json --prod` and filters findings to High/Critical
// severity in the production graph. Any unsuppressed High/Critical
// advisory exits the process non-zero, which is what makes the
// `supply-chain-security` job a credible required check on `main`.
//
// Moderate findings surface in the emitted `audit.json` artifact for
// triage but do not block the gate (per ADR-011: "Moderate findings
// surface in the JSON artifact for review but do not block.").
//
// Allow-list contract (Task #223):
//   The IGNORED map below is the suppression mechanism for the rare
//   advisory with no upstream patch and a documented unreachability
//   argument. Every entry MUST carry a non-empty `reason` string and a
//   `revisit` ISO-8601 date in the future. Entries that fail these
//   constraints fail the gate with an explicit message:
//     - "allow-list entry incomplete: <id> missing reason"
//     - "allow-list entry expired: <id> revisit <date>"
//   `pnpm.overrides` is the primary remediation lever (ADR-011); the
//   allow-list is the last resort.
//
// Exit codes:
//   0  — no unsuppressed High/Critical advisories
//   1  — one or more High/Critical advisories not in the allow-list,
//        OR an allow-list entry is malformed/expired
//   2  — unexpected error (audit invocation failed, JSON parse error)
//
// Usage:
//   node scripts/audit-check.mjs            # default: --level=high --prod
//   pnpm run audit:check
//
// The script writes the full audit findings list (including Moderate
// entries) to `audit.json` at the workspace root so CI can upload it
// as a 14-day workflow artifact for reviewer triage.

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Allow-list (suppression map). Keys are advisory IDs as returned by
// `pnpm audit --json` (GHSA-* preferred; numeric CVE IDs accepted).
// Every entry MUST carry { reason: <non-empty string>, revisit: <ISO date> }.
// Adding an entry is a deliberate act — pair it with a paragraph in the PR
// body explaining the unreachability argument.
// ---------------------------------------------------------------------------

/** @type {Record<string, { reason: string, revisit: string }>} */
export const IGNORED = {
  // Example shape (uncomment + populate when an exception is genuinely
  // needed):
  //
  // 'GHSA-xxxx-yyyy-zzzz': {
  //   reason: 'transitive in build-only dependency; not reached at runtime',
  //   revisit: '2026-12-01',
  // },
};

// ---------------------------------------------------------------------------
// Allow-list validator (Task #223)
// ---------------------------------------------------------------------------

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses an ISO-8601 date (YYYY-MM-DD) into a UTC-midnight Date.
 * Returns null when the input is malformed.
 *
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseRevisitDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

/**
 * Validates the IGNORED allow-list. Every entry MUST have a non-empty
 * `reason` and a `revisit` ISO-8601 date strictly in the future relative
 * to `now`.
 *
 * @param {Record<string, unknown>} ignored
 * @param {Date} now
 * @returns {{ valid: true } | { valid: false, errors: string[] }}
 */
export function validateAllowList(ignored, now) {
  const errors = [];
  for (const [id, raw] of Object.entries(ignored ?? {})) {
    if (!raw || typeof raw !== 'object') {
      errors.push(`allow-list entry incomplete: ${id} is not an object`);
      continue;
    }
    const entry = /** @type {{ reason?: unknown, revisit?: unknown }} */ (raw);
    const reason = entry.reason;
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      errors.push(`allow-list entry incomplete: ${id} missing reason`);
    }
    const revisit = entry.revisit;
    if (typeof revisit !== 'string' || !ISO_DATE_PATTERN.test(revisit)) {
      errors.push(`allow-list entry incomplete: ${id} missing or malformed revisit date`);
      continue;
    }
    const parsed = parseRevisitDate(revisit);
    if (parsed === null) {
      errors.push(`allow-list entry incomplete: ${id} missing or malformed revisit date`);
      continue;
    }
    if (parsed.getTime() <= now.getTime()) {
      errors.push(`allow-list entry expired: ${id} revisit ${revisit}`);
    }
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Audit invocation + findings normalization (Task #224)
// ---------------------------------------------------------------------------

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const SURFACED_SEVERITIES = new Set(['moderate', 'high', 'critical']);

/**
 * Spawns `pnpm audit --json --prod` and returns its stdout as a string.
 * pnpm audit exits non-zero when advisories are present, which is not
 * an error from our perspective — we parse the JSON either way.
 *
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{ stdout: string, stderr: string, code: number | null }>}
 */
export function runPnpmAudit({ cwd = process.cwd() } = {}) {
  return new Promise((resolveResult, rejectResult) => {
    // On Windows, `pnpm` resolves to `pnpm.cmd`/`pnpm.ps1` which Node's
    // direct-exec path (shell: false) cannot launch — that triggers
    // EINVAL. Enabling `shell: true` lets the OS dispatcher pick the
    // right wrapper and is the same idiom used by other scripts that
    // shell out to package-manager binaries.
    const useShell = process.platform === 'win32';
    const child = spawn('pnpm', ['audit', '--json', '--prod'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', rejectResult);
    child.on('close', (code) => {
      resolveResult({ stdout, stderr, code });
    });
  });
}

/**
 * Normalizes the heterogeneous shape pnpm audit emits into a flat list
 * of findings. pnpm audit's JSON payload carries an `advisories` map
 * keyed by advisory ID where each value is the advisory metadata
 * (severity, module_name, github_advisory_id, etc.). Empty payloads
 * (no advisories) come back as `{ advisories: {} }` or with the key
 * absent entirely.
 *
 * @param {unknown} payload
 * @returns {Array<{
 *   id: string,
 *   severity: string,
 *   module: string,
 *   title: string,
 *   url: string | null,
 *   raw: Record<string, unknown>,
 * }>}
 */
export function normalizeFindings(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const advisories = /** @type {Record<string, unknown>} */ (
    /** @type {Record<string, unknown>} */ (payload).advisories ?? {}
  );
  if (!advisories || typeof advisories !== 'object') {
    return [];
  }
  /** @type {Array<{ id: string, severity: string, module: string, title: string, url: string | null, raw: Record<string, unknown> }>} */
  const findings = [];
  for (const [key, value] of Object.entries(advisories)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const advisory = /** @type {Record<string, unknown>} */ (value);
    const ghsa = typeof advisory.github_advisory_id === 'string' ? advisory.github_advisory_id : null;
    const id = ghsa ?? key;
    const severity = typeof advisory.severity === 'string' ? advisory.severity.toLowerCase() : 'unknown';
    const moduleName = typeof advisory.module_name === 'string' ? advisory.module_name : 'unknown';
    const title = typeof advisory.title === 'string' ? advisory.title : '';
    const url = typeof advisory.url === 'string' ? advisory.url : null;
    findings.push({ id, severity, module: moduleName, title, url, raw: advisory });
  }
  return findings;
}

/**
 * Splits findings into blocking (High/Critical, unsuppressed), suppressed
 * (High/Critical matched against IGNORED), and surfaced-only (Moderate).
 *
 * @param {Array<{ id: string, severity: string, module: string, title: string, url: string | null, raw: Record<string, unknown> }>} findings
 * @param {Record<string, { reason: string, revisit: string }>} ignored
 */
export function partitionFindings(findings, ignored) {
  const blocking = [];
  const suppressed = [];
  const surfaced = [];
  for (const finding of findings) {
    if (BLOCKING_SEVERITIES.has(finding.severity)) {
      if (Object.prototype.hasOwnProperty.call(ignored, finding.id)) {
        suppressed.push(finding);
      } else {
        blocking.push(finding);
      }
    } else if (SURFACED_SEVERITIES.has(finding.severity)) {
      surfaced.push(finding);
    }
  }
  return { blocking, suppressed, surfaced };
}

/**
 * Builds the audit.json artifact body. Surfaces every High/Critical and
 * Moderate finding alongside the partition outcome so a human reviewer
 * can triage without re-running the audit locally.
 */
export function buildArtifact({ findings, blocking, suppressed, surfaced, generatedAt }) {
  return {
    schema: 'athportal-audit-check@1',
    generatedAt,
    summary: {
      totalFindings: findings.length,
      blocking: blocking.length,
      suppressed: suppressed.length,
      moderate: surfaced.length,
    },
    blocking,
    suppressed,
    moderate: surfaced,
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const now = new Date();

  // 1. Allow-list contract (Task #223). Validate before invoking pnpm
  //    audit so a malformed entry never silently suppresses a finding.
  const allowListResult = validateAllowList(IGNORED, now);
  if (!allowListResult.valid) {
    console.error('audit-check: allow-list contract violation:');
    for (const err of allowListResult.errors) {
      console.error(`  - ${err}`);
    }
    console.error(
      '\nEvery IGNORED entry MUST carry a non-empty `reason` and a `revisit` ISO-8601 date in the future (ADR-011).',
    );
    process.exit(1);
    return;
  }

  // 2. Run pnpm audit --json --prod.
  let auditResult;
  try {
    auditResult = await runPnpmAudit();
  } catch (err) {
    console.error('audit-check: failed to invoke pnpm audit');
    console.error(err);
    process.exit(2);
    return;
  }

  let payload;
  try {
    payload = auditResult.stdout.trim().length === 0 ? {} : JSON.parse(auditResult.stdout);
  } catch (err) {
    console.error('audit-check: failed to parse pnpm audit JSON output');
    console.error(err);
    if (auditResult.stderr) {
      console.error(auditResult.stderr);
    }
    process.exit(2);
    return;
  }

  // 3. Normalize + partition.
  const findings = normalizeFindings(payload);
  const { blocking, suppressed, surfaced } = partitionFindings(findings, IGNORED);

  // 4. Emit audit.json artifact (Task #224 AC).
  const artifact = buildArtifact({
    findings,
    blocking,
    suppressed,
    surfaced,
    generatedAt: now.toISOString(),
  });
  const artifactPath = resolve(process.cwd(), 'audit.json');
  try {
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error(`audit-check: failed to write audit.json at ${artifactPath}`);
    console.error(err);
    process.exit(2);
    return;
  }

  // 5. Report and exit.
  console.log(
    `audit-check: ${findings.length} finding(s) total — ` +
      `${blocking.length} blocking, ${suppressed.length} suppressed, ` +
      `${surfaced.length} moderate (surfaced only).`,
  );
  if (suppressed.length > 0) {
    console.log('audit-check: suppressed High/Critical advisories (allow-list):');
    for (const f of suppressed) {
      const entry = IGNORED[f.id];
      console.log(`  - ${f.id} (${f.module}) — revisit ${entry?.revisit}: ${entry?.reason}`);
    }
  }
  if (blocking.length > 0) {
    console.error('audit-check: ❌ unsuppressed High/Critical advisories present:');
    for (const f of blocking) {
      console.error(`  - ${f.id} [${f.severity}] ${f.module}: ${f.title}`);
      if (f.url) {
        console.error(`      ${f.url}`);
      }
    }
    console.error(
      '\nRemediate via `pnpm.overrides` in package.json (preferred per ADR-011) or, when no upstream patch exists and a documented unreachability argument applies, add an IGNORED entry with `reason` + future `revisit` date.',
    );
    process.exit(1);
    return;
  }

  console.log('audit-check: ✅ no unsuppressed High/Critical advisories.');
}

// Only execute when invoked directly (not when imported by tests).
// `fileURLToPath(import.meta.url)` normalizes Windows paths the same way
// the runtime normalizes `process.argv[1]`, so the equality holds whether
// the script was launched as `node scripts/audit-check.mjs`, via
// `pnpm run audit:check`, or as a temp-dir copy in the CLI tests.
import { fileURLToPath } from 'node:url';

const invokedDirectly = (() => {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    console.error('audit-check: unexpected error');
    console.error(err);
    process.exit(2);
  });
}
