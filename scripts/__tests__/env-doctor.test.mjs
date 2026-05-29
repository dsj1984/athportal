// scripts/__tests__/env-doctor.test.mjs
//
// Unit + contract coverage for the Env/Secrets readiness doctor
// (scripts/env/doctor.mjs). Story #1044.
//
// Pyramid tier: unit. The matrix builder and the surface classifiers are
// pure; the native `gh` / `wrangler` boundary is exercised via an injected
// `runner` stub (no real process spawn, no network), which is the doctor's
// own CLI contract surface — not an external service we'd run for real.
//
// What these lock in:
//   1. The manifest (.env.example `# surfaces:` markers) is the single
//      source of truth — parsed by check-env.mjs, never duplicated.
//   2. The present / missing / ⚠ placeholder matrix per environment.
//   3. Graceful per-surface degradation (an un-authed surface is
//      `skipped`, not `missing`, and does NOT flip the exit code).
//   4. The doctor never emits a secret value (rendered output + JSON).
//   5. Placeholder detection seeds pk_test_ / sk_test_ / empty / dummy
//      Sentry+Mux DSNs and is documented as S1-only.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  detectPlaceholder,
  loadManifest,
  parseManifest,
  parseSurfacesDirective,
} from '../check-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_EXAMPLE = resolve(HERE, '..', '..', '.env.example');
import {
  STATUS,
  buildMatrix,
  parseDotenv,
  queryGitHub,
  queryWrangler,
  renderMatrix,
  runDoctor,
} from '../env/doctor.mjs';

// A synthetic manifest covering all three surfaces and both shape/no-shape
// cases. Mirrors the real .env.example marker grammar.
const MANIFEST_SRC = [
  '# shape: nonempty',
  '# surfaces: S1',
  'NODE_ENV=development',
  '# shape: url',
  '# surfaces: S1; S2@staging,production',
  'DATABASE_URL=libsql://example.invalid',
  '# shape: nonempty',
  '# surfaces: S1; S2@staging,production',
  'SENTRY_AUTH_TOKEN=placeholder',
  '# surfaces: S4@staging,production',
  'OBSERVABILITY_ALERT_EMAIL=ops@example.invalid',
  '# surfaces: S2@production; S4@staging,production',
  'LOGPUSH_SINK_TOKEN=placeholder',
].join('\n');

const MANIFEST = parseManifest(MANIFEST_SRC);

// ---------------------------------------------------------------------------
// Single-source-of-truth: the real .env.example feeds the manifest
// ---------------------------------------------------------------------------

describe('manifest is sourced from the real .env.example (single SSOT)', () => {
  it('parses surface metadata for every foundational + worker key', () => {
    const manifest = loadManifest({ examplePath: REAL_EXAMPLE });
    const byKey = new Map(manifest.map((e) => [e.key, e]));

    // S1 + S2 foundational keys.
    for (const key of [
      'NODE_ENV',
      'DATABASE_URL',
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'SENTRY_DSN',
      'SENTRY_AUTH_TOKEN',
    ]) {
      expect(byKey.has(key), `${key} missing from manifest`).toBe(true);
    }
    // S4-only worker secrets carry surfaces but NO shape (so they stay out
    // of the check-env local gate).
    expect(byKey.get('OBSERVABILITY_ALERT_EMAIL').shape).toBe(null);
    expect(byKey.get('OBSERVABILITY_ALERT_EMAIL').surfaces).toEqual([
      { surface: 'S4', envs: ['staging', 'production'] },
    ]);
    expect(byKey.get('LOGPUSH_SINK_TOKEN').shape).toBe(null);
  });
});

describe('parseSurfacesDirective', () => {
  it('expands a multi-clause directive into surface/env requirements', () => {
    expect(parseSurfacesDirective('S1; S2@staging,production')).toEqual([
      { surface: 'S1', envs: [] },
      { surface: 'S2', envs: ['staging', 'production'] },
    ]);
  });

  it('defaults a remote surface with no @env to all environments', () => {
    expect(parseSurfacesDirective('S4')).toEqual([
      { surface: 'S4', envs: ['staging', 'production'] },
    ]);
  });

  it('throws on an unknown surface or environment (fail-loud manifest)', () => {
    expect(() => parseSurfacesDirective('S9')).toThrow(/unknown surface/);
    expect(() => parseSurfacesDirective('S2@nonsense')).toThrow(/unknown environment/);
  });
});

// ---------------------------------------------------------------------------
// detectPlaceholder — S1-only placeholder vocabulary
// ---------------------------------------------------------------------------

describe('detectPlaceholder (S1-only placeholder detection)', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['pk_test_abcdef', 'clerk-test-key'],
    ['sk_test_abcdef', 'clerk-test-key'],
    ['https://public@sentry.example.invalid/1', 'example-dsn'],
    ['cf_token_placeholder', 'literal-placeholder'],
    ['your_turso_auth_token', 'literal-placeholder'],
    ['replace-with-strong-random-password', 'literal-placeholder'],
    ['xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'literal-placeholder'],
    ['00000000000000000000000000000000', 'all-zero-account-id'],
  ])('flags %j as a placeholder', (value, reason) => {
    const result = detectPlaceholder(value);
    expect(result.placeholder).toBe(true);
    expect(result.reason).toBe(reason);
  });

  // NB: deliberately avoid live-credential-shaped literals (e.g.
  // `sk_live_…`) here — the gitleaks PR-diff scan flags them even in a
  // test asserting they are NOT placeholders. The detector only treats
  // the `*_test_` prefixes as placeholders, so any non-prefixed string
  // exercises the same "real value" branch.
  it.each([
    ['production'],
    ['libsql://athportal-prod-real.turso.io'],
    ['a-genuine-looking-runtime-credential'],
    ['deadbeef00000000deadbeef00000000'],
  ])('treats %j as a real (non-placeholder) value', (value) => {
    expect(detectPlaceholder(value).placeholder).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseDotenv — minimal local .env reader
// ---------------------------------------------------------------------------

describe('parseDotenv', () => {
  it('parses KEY=value lines, strips quotes, ignores comments', () => {
    const env = parseDotenv(
      [
        '# comment',
        'NODE_ENV=production',
        'QUOTED="with spaces"',
        "SINGLE='q'",
        '',
        'lowercase=skip',
      ].join('\n'),
    );
    expect(env.NODE_ENV).toBe('production');
    expect(env.QUOTED).toBe('with spaces');
    expect(env.SINGLE).toBe('q');
    expect(env).not.toHaveProperty('lowercase');
  });
});

// ---------------------------------------------------------------------------
// buildMatrix — local (S1) surface
// ---------------------------------------------------------------------------

describe('buildMatrix — local (S1)', () => {
  it('passes when every S1 key is present and non-placeholder', () => {
    const matrix = buildMatrix({
      manifest: MANIFEST,
      env: 'local',
      local: {
        available: true,
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: 'libsql://real.turso.io',
          SENTRY_AUTH_TOKEN: 'realsecret',
        },
      },
    });
    expect(matrix.ok).toBe(true);
    expect(matrix.surfaces).toEqual(['S1']);
  });

  it('marks a placeholder S1 value as ⚠ placeholder and fails the run', () => {
    const matrix = buildMatrix({
      manifest: MANIFEST,
      env: 'local',
      local: {
        available: true,
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: 'libsql://real.turso.io',
          SENTRY_AUTH_TOKEN: 'cf_token_placeholder',
        },
      },
    });
    const cell = matrix.rows.find((r) => r.key === 'SENTRY_AUTH_TOKEN').cells.S1;
    expect(cell.status).toBe(STATUS.PLACEHOLDER);
    expect(matrix.ok).toBe(false);
  });

  it('marks a shape-invalid or absent S1 value as missing', () => {
    const matrix = buildMatrix({
      manifest: MANIFEST,
      env: 'local',
      local: {
        available: true,
        env: { DATABASE_URL: 'not-a-url', SENTRY_AUTH_TOKEN: 'realsecret' },
      },
    });
    expect(matrix.rows.find((r) => r.key === 'NODE_ENV').cells.S1.status).toBe(STATUS.MISSING);
    expect(matrix.rows.find((r) => r.key === 'DATABASE_URL').cells.S1.status).toBe(STATUS.MISSING);
    expect(matrix.ok).toBe(false);
  });

  it('excludes S4-only keys from the local matrix', () => {
    const matrix = buildMatrix({
      manifest: MANIFEST,
      env: 'local',
      local: {
        available: true,
        env: {
          NODE_ENV: 'production',
          DATABASE_URL: 'libsql://r.turso.io',
          SENTRY_AUTH_TOKEN: 'x',
        },
      },
    });
    expect(matrix.rows.find((r) => r.key === 'OBSERVABILITY_ALERT_EMAIL')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildMatrix — deploy (S2/S4) surfaces
// ---------------------------------------------------------------------------

describe('buildMatrix — deploy env (S2/S4)', () => {
  it('marks present remote names present and missing names missing', () => {
    const matrix = buildMatrix({
      manifest: MANIFEST,
      env: 'staging',
      github: { available: true, names: new Set(['DATABASE_URL']) },
      wrangler: {
        available: true,
        names: new Set(['OBSERVABILITY_ALERT_EMAIL', 'LOGPUSH_SINK_TOKEN']),
      },
    });
    expect(matrix.rows.find((r) => r.key === 'DATABASE_URL').cells.S2.status).toBe(STATUS.PRESENT);
    expect(matrix.rows.find((r) => r.key === 'SENTRY_AUTH_TOKEN').cells.S2.status).toBe(
      STATUS.MISSING,
    );
    expect(matrix.rows.find((r) => r.key === 'OBSERVABILITY_ALERT_EMAIL').cells.S4.status).toBe(
      STATUS.PRESENT,
    );
    expect(matrix.ok).toBe(false); // SENTRY_AUTH_TOKEN missing on S2
  });

  it('honors per-env scoping: LOGPUSH_SINK_TOKEN is S2 on production only', () => {
    const staging = buildMatrix({
      manifest: MANIFEST,
      env: 'staging',
      github: { available: true, names: new Set(['DATABASE_URL', 'SENTRY_AUTH_TOKEN']) },
      wrangler: {
        available: true,
        names: new Set(['OBSERVABILITY_ALERT_EMAIL', 'LOGPUSH_SINK_TOKEN']),
      },
    });
    // On staging LOGPUSH_SINK_TOKEN must NOT have an S2 cell (S2@production only).
    expect(staging.rows.find((r) => r.key === 'LOGPUSH_SINK_TOKEN').cells.S2).toBeUndefined();
    expect(staging.ok).toBe(true);

    const production = buildMatrix({
      manifest: MANIFEST,
      env: 'production',
      github: { available: true, names: new Set(['DATABASE_URL', 'SENTRY_AUTH_TOKEN']) },
      wrangler: {
        available: true,
        names: new Set(['OBSERVABILITY_ALERT_EMAIL', 'LOGPUSH_SINK_TOKEN']),
      },
    });
    // On production LOGPUSH_SINK_TOKEN IS required on S2 → missing here.
    expect(production.rows.find((r) => r.key === 'LOGPUSH_SINK_TOKEN').cells.S2.status).toBe(
      STATUS.MISSING,
    );
    expect(production.ok).toBe(false);
  });

  it('degrades gracefully: an unavailable surface is skipped, not missing, and does not fail', () => {
    const matrix = buildMatrix({
      manifest: MANIFEST,
      env: 'staging',
      github: { available: false, reason: 'gh not authenticated' },
      wrangler: { available: false, reason: 'wrangler not authenticated' },
    });
    const cell = matrix.rows.find((r) => r.key === 'DATABASE_URL').cells.S2;
    expect(cell.status).toBe(STATUS.SKIPPED);
    expect(cell.reason).toMatch(/not authenticated/);
    expect(matrix.ok).toBe(true); // skipped never fails the run
  });

  it('excludes S1-only keys (NODE_ENV) from a deploy-env matrix', () => {
    const matrix = buildMatrix({
      manifest: MANIFEST,
      env: 'staging',
      github: { available: true, names: new Set(['DATABASE_URL', 'SENTRY_AUTH_TOKEN']) },
      wrangler: {
        available: true,
        names: new Set(['OBSERVABILITY_ALERT_EMAIL', 'LOGPUSH_SINK_TOKEN']),
      },
    });
    expect(matrix.rows.find((r) => r.key === 'NODE_ENV')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// queryGitHub / queryWrangler — runner-boundary contract
// ---------------------------------------------------------------------------

describe('queryGitHub (gh boundary, mocked runner)', () => {
  it('collects secret + variable names when authed', () => {
    const calls = [];
    const runner = (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'auth') return { ok: true, stdout: '', stderr: '' };
      if (args[0] === 'secret') {
        return { ok: true, stdout: JSON.stringify([{ name: 'DATABASE_URL' }]), stderr: '' };
      }
      return { ok: true, stdout: JSON.stringify([{ name: 'TURBO_TEAM' }]), stderr: '' };
    };
    const result = queryGitHub('staging', { runner });
    expect(result.available).toBe(true);
    expect([...result.names].sort()).toEqual(['DATABASE_URL', 'TURBO_TEAM']);
    // Auth preflight ran first.
    expect(calls[0]).toEqual(['gh', 'auth', 'status']);
  });

  it('degrades when gh auth status fails (no secret list attempted)', () => {
    const calls = [];
    const runner = (cmd, args) => {
      calls.push(args[0]);
      return { ok: false, stdout: '', stderr: 'not logged in', code: 1 };
    };
    const result = queryGitHub('staging', { runner });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/not authenticated/);
    expect(calls).toEqual(['auth']); // never reached secret/variable list
  });

  it('degrades on a non-zero secret list (e.g. no env access)', () => {
    const runner = (cmd, args) => {
      if (args[0] === 'auth') return { ok: true, stdout: '', stderr: '' };
      return { ok: false, stdout: '', stderr: 'HTTP 404', code: 1 };
    };
    const result = queryGitHub('staging', { runner });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/gh secret list/);
  });
});

describe('queryWrangler (wrangler boundary, mocked runner)', () => {
  it('collects worker secret names when authed', () => {
    const runner = (cmd, args) => {
      if (args[0] === 'whoami') return { ok: true, stdout: '', stderr: '' };
      return {
        ok: true,
        stdout: JSON.stringify([{ name: 'OBSERVABILITY_ALERT_EMAIL', type: 'secret_text' }]),
        stderr: '',
      };
    };
    const result = queryWrangler('production', { runner });
    expect(result.available).toBe(true);
    expect([...result.names]).toEqual(['OBSERVABILITY_ALERT_EMAIL']);
  });

  it('degrades when wrangler whoami fails', () => {
    const runner = () => ({ ok: false, stdout: '', stderr: 'not authed', code: 1 });
    const result = queryWrangler('production', { runner });
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/not authenticated/);
  });
});

// ---------------------------------------------------------------------------
// runDoctor — end-to-end wiring with a mocked runner
// ---------------------------------------------------------------------------

describe('runDoctor (wiring, mocked runner)', () => {
  function makeRunner({ ghNames = [], whoamiOk = true, wranglerNames = [] }) {
    return (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'auth') return { ok: true, stdout: '', stderr: '' };
      if (cmd === 'gh')
        return { ok: true, stdout: JSON.stringify(ghNames.map((name) => ({ name }))), stderr: '' };
      if (cmd === 'wrangler' && args[0] === 'whoami') {
        return whoamiOk
          ? { ok: true, stdout: '', stderr: '' }
          : { ok: false, stderr: 'no', code: 1 };
      }
      if (cmd === 'wrangler') {
        return {
          ok: true,
          stdout: JSON.stringify(wranglerNames.map((name) => ({ name }))),
          stderr: '',
        };
      }
      return { ok: false, stdout: '', stderr: 'unknown', code: 1 };
    };
  }

  it('reports degraded surfaces in the degraded list', () => {
    const runner = makeRunner({ ghNames: ['DATABASE_URL', 'SENTRY_AUTH_TOKEN'], whoamiOk: false });
    const { matrix, degraded } = runDoctor({ env: 'staging', manifest: MANIFEST, runner });
    expect(degraded).toHaveLength(1);
    expect(degraded[0].surface).toMatch(/Cloudflare/);
    // S2 fully present, S4 degraded → run still passes (skipped never fails).
    expect(matrix.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderMatrix — never leaks a value
// ---------------------------------------------------------------------------

describe('renderMatrix (no secret-value leakage)', () => {
  it('renders status glyphs and reason categories, never the value', () => {
    const SECRET = 'libsql://super-secret-real-value.turso.io';
    const matrix = buildMatrix({
      manifest: MANIFEST,
      env: 'local',
      local: {
        available: true,
        env: { NODE_ENV: 'production', DATABASE_URL: SECRET, SENTRY_AUTH_TOKEN: 'realsecret' },
      },
    });
    const out = renderMatrix(matrix);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('super-secret');
    expect(out).toContain('present');
  });

  it('surfaces a degraded note for skipped surfaces', () => {
    const matrix = buildMatrix({
      manifest: MANIFEST,
      env: 'staging',
      github: { available: false, reason: 'gh not authed' },
      wrangler: { available: false, reason: 'wrangler not authed' },
    });
    const out = renderMatrix(matrix, {
      degraded: [{ surface: 'S2 (GitHub Actions)', reason: 'gh not authed' }],
    });
    expect(out).toMatch(/couldn't check S2/);
    expect(out).toMatch(/presence ≠ correctness/);
  });
});
