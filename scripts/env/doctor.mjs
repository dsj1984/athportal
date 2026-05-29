#!/usr/bin/env node
// scripts/env/doctor.mjs
//
// Env/Secrets readiness doctor — one command that reports whether every
// REQUIRED env key is actually present across athportal's deployment
// surfaces, per environment, with a CI-friendly exit code.
//
// The manifest lives in `.env.example` (the `# shape:` + `# surfaces:`
// markers, parsed by scripts/check-env.mjs). This script is a READ-ONLY
// cross-surface query over that single source of truth — it never writes,
// echoes, or persists a secret value.
//
// Surfaces (see `.env.example` header):
//   - S1 : local `.env`           — values readable: shape (reuse
//                                    check-env) + ⚠️ placeholder detection
//   - S2 : GitHub Actions env      — `gh secret list` / `gh variable list
//                                    --env <e>` — NAMES ONLY
//   - S4 : Cloudflare Worker       — `wrangler secret list --env <e>` —
//                                    NAMES ONLY
//
// Presence ≠ correctness: S2/S4 return names only, so the doctor checks
// PRESENCE there; ⚠️ placeholder-shape detection is possible only on S1,
// where local values are readable.
//
// Usage:
//   node scripts/env/doctor.mjs [--env <staging|production|local>] [--json]
//   node scripts/env/doctor.mjs --self-test   # internal self-test over
//                                              # synthetic fixtures (matches
//                                              # check-env.mjs's convention)
//
// Exit codes:
//   0 — every required key present (and, on S1, non-placeholder)
//   1 — one or more required keys missing or ⚠️ placeholder
//   2 — usage error (bad --env value)
//
// Auth preflight (`gh auth status`, `wrangler whoami`) degrades GRACEFULLY
// per surface: an un-authed surface is reported as "couldn't check" and
// does NOT mark its required keys as missing — only a hard "key absent on
// an authed surface" or "S1 placeholder" flips the exit code.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ENVIRONMENTS,
  defaultExamplePath,
  detectPlaceholder,
  loadManifest,
  parseManifest,
  validateEnv,
} from '../check-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Per-key/per-surface status vocabulary used in the matrix.
export const STATUS = Object.freeze({
  PRESENT: 'present',
  MISSING: 'missing',
  PLACEHOLDER: 'placeholder',
  SKIPPED: 'skipped', // surface unavailable (auth/tool degraded)
});

// ---------------------------------------------------------------------------
// Local `.env` loading (S1)
// ---------------------------------------------------------------------------

/**
 * Minimal `.env` parser — `KEY=value` lines, `#` comments, optional
 * surrounding quotes. We deliberately avoid a dependency: the doctor must
 * run from a bare `node scripts/env/doctor.mjs` with nothing installed.
 * Returns a plain object of key → value (values are NEVER logged).
 */
export function parseDotenv(source) {
  const out = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read the local `.env` (S1 surface). Falls back to `process.env` overlay
 * so a CI host that surfaces keys via the process environment (no `.env`
 * file) still validates. Returns `{ available, env, reason? }`.
 */
export function loadLocalEnv({ envPath, processEnv = process.env } = {}) {
  const fileEnv = {};
  let fileFound = false;
  if (envPath && existsSync(envPath)) {
    Object.assign(fileEnv, parseDotenv(readFileSync(envPath, 'utf8')));
    fileFound = true;
  }
  // process.env wins over the file so CI hosts (which inject secrets as
  // real env vars) are validated against the live values.
  const env = { ...fileEnv, ...processEnv };
  return { available: true, env, fileFound };
}

// ---------------------------------------------------------------------------
// Remote surface queriers (S2 GitHub Actions, S4 Cloudflare Worker)
// ---------------------------------------------------------------------------

/**
 * Default command runner — `spawnSync` wrapper returning
 * `{ ok, stdout, stderr }`. Injected into queriers so tests can stub the
 * `gh` / `wrangler` boundary without spawning a real process.
 */
export function defaultRunner(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.error) {
    return { ok: false, stdout: '', stderr: result.error.message, code: null };
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status,
  };
}

/**
 * Query the GitHub Actions surface (S2) for a given environment: the set
 * of Environment SECRET names + VARIABLE names. Names only — `gh` never
 * returns secret values. Degrades gracefully: a failed `gh auth status`
 * (or a missing `gh`) returns `{ available: false, reason }` so the
 * caller can report "couldn't check S2" rather than abort.
 */
export function queryGitHub(env, { runner = defaultRunner } = {}) {
  const auth = runner('gh', ['auth', 'status']);
  if (!auth.ok) {
    return { available: false, reason: 'gh not authenticated (gh auth status failed)' };
  }

  const names = new Set();
  for (const kind of ['secret', 'variable']) {
    const res = runner('gh', [kind, 'list', '--env', env, '--json', 'name']);
    if (!res.ok) {
      return {
        available: false,
        reason: `gh ${kind} list --env ${env} failed (${(res.stderr || '').trim() || `exit ${res.code}`})`,
      };
    }
    try {
      const parsed = JSON.parse(res.stdout || '[]');
      for (const row of parsed) {
        if (row && typeof row.name === 'string') names.add(row.name);
      }
    } catch {
      return { available: false, reason: `gh ${kind} list returned unparseable JSON` };
    }
  }
  return { available: true, names };
}

/**
 * Query the Cloudflare Worker surface (S4) for a given environment: the
 * set of Worker SECRET names via `wrangler secret list --env <e>`. Names
 * only. Degrades gracefully on a failed `wrangler whoami` or a missing
 * `wrangler` binary.
 */
export function queryWrangler(env, { runner = defaultRunner } = {}) {
  const who = runner('wrangler', ['whoami']);
  if (!who.ok) {
    return { available: false, reason: 'wrangler not authenticated (wrangler whoami failed)' };
  }

  const res = runner('wrangler', ['secret', 'list', '--env', env]);
  if (!res.ok) {
    return {
      available: false,
      reason: `wrangler secret list --env ${env} failed (${(res.stderr || '').trim() || `exit ${res.code}`})`,
    };
  }

  const names = new Set();
  // `wrangler secret list` emits a JSON array of `{ name, type }`.
  try {
    const parsed = JSON.parse(res.stdout || '[]');
    for (const row of parsed) {
      if (row && typeof row.name === 'string') names.add(row.name);
    }
  } catch {
    return { available: false, reason: 'wrangler secret list returned unparseable JSON' };
  }
  return { available: true, names };
}

// ---------------------------------------------------------------------------
// Matrix builder (pure core)
// ---------------------------------------------------------------------------

/**
 * Does a manifest entry require a given surface for a given environment?
 * S1 is environment-agnostic (its `envs` is always `[]`).
 */
function entryRequiresSurface(entry, surface, env) {
  for (const req of entry.surfaces) {
    if (req.surface !== surface) continue;
    if (surface === 'S1') return true;
    if (req.envs.includes(env)) return true;
  }
  return false;
}

/**
 * Build the readiness matrix for ONE environment from the manifest and
 * the per-surface live data. Pure — no I/O — so unit tests drive it
 * directly. Inputs:
 *
 *   manifest       : parseManifest(...) entries
 *   env            : 'local' | 'staging' | 'production'
 *   local          : { available, env } from loadLocalEnv (S1 values)
 *   github         : { available, names? , reason? } from queryGitHub
 *   wrangler       : { available, names?, reason? } from queryWrangler
 *
 * Returns `{ env, rows, surfaces, ok }` where each row is
 *   { key, cells: { S1?, S2?, S4? } } and a cell is
 *   { status, reason? }. `ok` is false when any required cell is
 *   `missing` or `placeholder` (a `skipped` surface never fails the run).
 */
export function buildMatrix({ manifest, env, local, github, wrangler }) {
  // S1 only applies to the `local` view; S2/S4 only apply to a deploy env.
  const isLocal = env === 'local';
  const surfaces = isLocal ? ['S1'] : ['S2', 'S4'];

  // Pre-compute S1 shape failures via check-env's validator so the doctor
  // and the check-env gate agree byte-for-byte on what "missing/invalid"
  // means locally.
  const s1Entries = manifest
    .filter((e) => e.shape !== null && entryRequiresSurface(e, 'S1', env))
    .map((e) => ({ key: e.key, shape: e.shape }));
  const s1Failures = local?.available ? validateEnv(s1Entries, local.env) : [];
  const s1FailByKey = new Map(s1Failures.map((f) => [f.key, f]));

  const rows = [];
  let ok = true;

  for (const entry of manifest) {
    const cells = {};
    let rowApplies = false;

    for (const surface of surfaces) {
      if (!entryRequiresSurface(entry, surface, env)) continue;
      rowApplies = true;

      if (surface === 'S1') {
        cells.S1 = classifyS1(entry, { local, s1FailByKey });
      } else if (surface === 'S2') {
        cells.S2 = classifyRemote(entry.key, github);
      } else if (surface === 'S4') {
        cells.S4 = classifyRemote(entry.key, wrangler);
      }
    }

    if (!rowApplies) continue;

    for (const cell of Object.values(cells)) {
      if (cell.status === STATUS.MISSING || cell.status === STATUS.PLACEHOLDER) {
        ok = false;
      }
    }
    rows.push({ key: entry.key, cells });
  }

  return { env, surfaces, rows, ok };
}

/**
 * Classify the S1 (local) cell for a manifest entry. Order:
 *   1. surface unavailable        → skipped
 *   2. check-env shape failure    → missing (absent or shape-invalid)
 *   3. placeholder value          → placeholder (⚠️ present-but-fake)
 *   4. otherwise                  → present
 * NEVER returns the value — only a status + a short reason category.
 */
function classifyS1(entry, { local, s1FailByKey }) {
  if (!local?.available) {
    return { status: STATUS.SKIPPED, reason: local?.reason ?? 'local .env unavailable' };
  }
  const fail = s1FailByKey.get(entry.key);
  if (fail) {
    return { status: STATUS.MISSING, reason: fail.reason };
  }
  const value = local.env[entry.key];
  // Entries with no shape still get a presence + placeholder check on S1
  // when they declare S1 (rare — most S1 keys carry a shape).
  if (value === undefined || value === '') {
    return { status: STATUS.MISSING, reason: 'missing' };
  }
  const placeholder = detectPlaceholder(value);
  if (placeholder.placeholder) {
    return { status: STATUS.PLACEHOLDER, reason: placeholder.reason };
  }
  return { status: STATUS.PRESENT };
}

/**
 * Classify a remote (S2/S4) cell from a name-set query result. The query
 * returns NAMES ONLY, so the only judgements are present / missing /
 * skipped — never placeholder (presence ≠ correctness).
 */
function classifyRemote(key, surfaceResult) {
  if (!surfaceResult || !surfaceResult.available) {
    return { status: STATUS.SKIPPED, reason: surfaceResult?.reason ?? 'surface unavailable' };
  }
  if (surfaceResult.names.has(key)) {
    return { status: STATUS.PRESENT };
  }
  return { status: STATUS.MISSING, reason: 'name absent on surface' };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STATUS_GLYPH = {
  [STATUS.PRESENT]: '✓ present',
  [STATUS.MISSING]: '✗ missing',
  [STATUS.PLACEHOLDER]: '⚠ placeholder',
  [STATUS.SKIPPED]: '· skipped',
};

/**
 * Render the matrix as a human-readable table string. Pure — returns the
 * string rather than writing it — so tests can assert on it. The reason
 * categories are safe to print (they are shape labels, never values).
 */
export function renderMatrix(matrix, { degraded = [] } = {}) {
  const lines = [];
  lines.push(`Env/Secrets readiness — environment: ${matrix.env}`);
  lines.push('');

  if (degraded.length > 0) {
    for (const d of degraded) {
      lines.push(`⚠ couldn't check ${d.surface}: ${d.reason}`);
    }
    lines.push('');
  }

  const keyWidth = Math.max(3, ...matrix.rows.map((r) => r.key.length));
  const header = ['KEY'.padEnd(keyWidth), ...matrix.surfaces.map((s) => s.padEnd(16))].join('  ');
  lines.push(header);
  lines.push('-'.repeat(header.length));

  for (const row of matrix.rows) {
    const cols = [row.key.padEnd(keyWidth)];
    for (const surface of matrix.surfaces) {
      const cell = row.cells[surface];
      if (!cell) {
        cols.push('—'.padEnd(16));
        continue;
      }
      const glyph = STATUS_GLYPH[cell.status] ?? cell.status;
      const reason = cell.reason ? ` (${cell.reason})` : '';
      cols.push(`${glyph}${reason}`.padEnd(16));
    }
    lines.push(cols.join('  '));
  }

  lines.push('');
  lines.push(matrix.ok ? '✓ all required keys present' : '✗ readiness check FAILED');
  if (matrix.env !== 'local') {
    lines.push(
      'note: S2/S4 are name-only (presence ≠ correctness); placeholder detection is S1-only.',
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Orchestration (impure — wires the queriers to the pure core)
// ---------------------------------------------------------------------------

/**
 * Run the doctor for a single environment. `runner` is injected so the
 * native `gh` / `wrangler` boundary can be mocked in tests. Returns
 * `{ matrix, degraded }`.
 */
export function runDoctor({
  env,
  manifest,
  envPath = resolve(HERE, '..', '..', '.env'),
  processEnv = process.env,
  runner = defaultRunner,
} = {}) {
  const isLocal = env === 'local';

  const local = isLocal ? loadLocalEnv({ envPath, processEnv }) : { available: false };
  const github = isLocal ? { available: false } : queryGitHub(env, { runner });
  const wrangler = isLocal ? { available: false } : queryWrangler(env, { runner });

  const matrix = buildMatrix({ manifest, env, local, github, wrangler });

  const degraded = [];
  if (!isLocal) {
    if (!github.available) degraded.push({ surface: 'S2 (GitHub Actions)', reason: github.reason });
    if (!wrangler.available)
      degraded.push({ surface: 'S4 (Cloudflare Worker)', reason: wrangler.reason });
  }

  return { matrix, degraded };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const VALID_ENVS = new Set(['local', ...ENVIRONMENTS]);

function parseArgs(argv) {
  const args = { env: 'staging', json: false, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--self-test') args.selfTest = true;
    else if (a === '--json') args.json = true;
    else if (a === '--env') {
      args.env = argv[i + 1];
      i += 1;
    } else if (a.startsWith('--env=')) {
      args.env = a.slice('--env='.length);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  if (!VALID_ENVS.has(args.env)) {
    process.stderr.write(
      `doctor: invalid --env "${args.env}" (expected one of: local, ${ENVIRONMENTS.join(', ')})\n`,
    );
    process.exit(2);
  }

  const manifest = loadManifest({ examplePath: defaultExamplePath() });
  const { matrix, degraded } = runDoctor({ env: args.env, manifest });

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...matrix, degraded }, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderMatrix(matrix, { degraded })}\n`);
  }

  process.exit(matrix.ok ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Self-test (mirrors check-env.mjs's --self-test convention)
// ---------------------------------------------------------------------------

function runSelfTest() {
  const fail = (msg) => {
    process.stderr.write(`doctor self-test FAILED: ${msg}\n`);
    process.exit(1);
  };

  const SYNTHETIC = [
    '# shape: nonempty',
    '# surfaces: S1',
    'NODE_ENV=development',
    '# shape: url',
    '# surfaces: S1; S2@staging,production',
    'DATABASE_URL=libsql://example.invalid',
    '# surfaces: S4@staging,production',
    'WORKER_ONLY_SECRET=ignored',
  ].join('\n');
  const manifest = parseManifest(SYNTHETIC);

  // 1) Local: a placeholder value must classify as ⚠ placeholder, a real
  //    value as present, an empty value as missing.
  const localGood = buildMatrix({
    manifest,
    env: 'local',
    local: {
      available: true,
      env: { NODE_ENV: 'production', DATABASE_URL: 'libsql://db.real.turso.io' },
    },
  });
  if (!localGood.ok) fail('expected clean local env to pass');
  if (localGood.rows.find((r) => r.key === 'WORKER_ONLY_SECRET')) {
    fail('S4-only key must not appear in the local matrix');
  }

  const localPlaceholder = buildMatrix({
    manifest,
    env: 'local',
    local: {
      available: true,
      env: { NODE_ENV: 'production', DATABASE_URL: 'libsql://placeholder.turso.io' },
    },
  });
  if (localPlaceholder.ok) fail('expected placeholder DATABASE_URL to fail local readiness');
  const dbCell = localPlaceholder.rows.find((r) => r.key === 'DATABASE_URL').cells.S1;
  if (dbCell.status !== STATUS.PLACEHOLDER) {
    fail(`expected DATABASE_URL S1 cell to be placeholder, got ${dbCell.status}`);
  }

  // 2) Deploy env: a present remote name passes; a missing one fails;
  //    an unavailable surface degrades (skipped, does NOT fail).
  const stagingPresent = buildMatrix({
    manifest,
    env: 'staging',
    github: { available: true, names: new Set(['DATABASE_URL']) },
    wrangler: { available: true, names: new Set(['WORKER_ONLY_SECRET']) },
  });
  if (!stagingPresent.ok) fail('expected all-present staging surfaces to pass');

  const stagingMissing = buildMatrix({
    manifest,
    env: 'staging',
    github: { available: true, names: new Set([]) },
    wrangler: { available: true, names: new Set(['WORKER_ONLY_SECRET']) },
  });
  if (stagingMissing.ok) fail('expected missing DATABASE_URL on S2 to fail');

  const stagingDegraded = buildMatrix({
    manifest,
    env: 'staging',
    github: { available: false, reason: 'gh not authed' },
    wrangler: { available: false, reason: 'wrangler not authed' },
  });
  if (!stagingDegraded.ok) {
    fail('expected fully-degraded surfaces to NOT fail the run (graceful degradation)');
  }
  const skippedCell = stagingDegraded.rows.find((r) => r.key === 'DATABASE_URL').cells.S2;
  if (skippedCell.status !== STATUS.SKIPPED) {
    fail(`expected degraded S2 cell to be skipped, got ${skippedCell.status}`);
  }

  // 3) NODE_ENV (S1-only) must not appear in a deploy-env matrix.
  if (stagingPresent.rows.find((r) => r.key === 'NODE_ENV')) {
    fail('S1-only NODE_ENV must not appear in a deploy-env matrix');
  }

  // 4) Render must never leak a value (the synthetic value is a marker).
  const rendered = renderMatrix(localPlaceholder);
  if (rendered.includes('placeholder.turso.io')) {
    fail('rendered matrix leaked a secret value');
  }

  process.stdout.write('doctor self-test OK\n');
  process.exit(0);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`;

if (invokedDirectly) {
  main();
}
