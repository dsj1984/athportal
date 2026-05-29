#!/usr/bin/env node
// scripts/check-env.mjs
//
// Validate that the host process environment satisfies the foundational
// environment contract declared in .env.example. The contract is expressed
// inline: every required key in the example file is listed (un-commented),
// and shape rules are attached via a sibling `# shape: <name>` comment line
// immediately preceding the key.
//
// Why parse .env.example instead of hard-coding the schema? The example
// file is already the source of truth devs read when wiring a new host.
// Keeping the validator's schema co-located with the documentation means
// adding a key in one place (the example) automatically extends the
// pre-deploy contract — no second file to keep in sync.
//
// A key is considered REQUIRED only when it carries a `# shape:` marker
// in the example file. Un-tagged keys remain in .env.example as advisory
// documentation but are not enforced — this keeps the foundational
// contract small and explicit while still letting the example double as
// a config reference for legacy/optional knobs.
//
// This module ALSO parses the cross-surface readiness manifest used by
// scripts/env/doctor.mjs (the `# surfaces:` markers). parseEnvExample /
// validateEnv stay byte-identical to preserve the local check-env gate;
// the doctor-facing helpers (parseManifest, parseSurfacesDirective,
// detectPlaceholder, loadManifest, SURFACES, ENVIRONMENTS) are additive
// exports so the manifest has exactly one source of truth — this file.
//
// Usage:
//   node scripts/check-env.mjs              # validate process.env
//   node scripts/check-env.mjs --self-test  # run an internal self-test
//                                           # over synthetic fixtures
//
// Exit codes:
//   0 — every required key present and shape-valid
//   1 — one or more keys missing or shape-invalid (offending key printed
//       to stderr)
//
// Skill registry — supported shape markers:
//   nonempty               — string with at least one non-whitespace char
//   url                    — parses as an absolute URL whose protocol is one
//                            of http:, https:, or libsql: (the Turso scheme
//                            DATABASE_URL uses in staging/production)
//   cloudflare-account-id  — 32-char lowercase hex string

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHAPES = {
  nonempty: (value) => typeof value === 'string' && value.trim().length > 0,
  url: (value) => {
    if (typeof value !== 'string' || value.length === 0) return false;
    try {
      const parsed = new URL(value);
      return (
        parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'libsql:'
      );
    } catch {
      return false;
    }
  },
  'cloudflare-account-id': (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value),
};

/**
 * Parse a .env.example body into an ordered list of `{ key, shape }` entries.
 *
 * Only keys that carry a preceding `# shape: <name>` marker are emitted —
 * untagged `KEY=value` lines are treated as advisory documentation and
 * deliberately omitted from the required set so the contract stays
 * explicit and minimal.
 *
 * Rules:
 *   - Blank lines and pure comment blocks (not preceding a key) are ignored.
 *   - A line of the form `# shape: <name>` attaches that shape to the NEXT
 *     `KEY=value` line. Any other comment line resets the pending shape,
 *     EXCEPT a `# surfaces: <list>` marker (the doctor's manifest
 *     directive) which is sibling to `# shape:` and may sit between the
 *     shape marker and the key — it is transparent to this parser so the
 *     check-env contract is unchanged by adding surface metadata.
 *   - A `KEY=value` line without a pending shape marker is skipped.
 */
export function parseEnvExample(source) {
  const lines = source.split(/\r?\n/);
  const entries = [];
  let pendingShape = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.length === 0) {
      pendingShape = null;
      continue;
    }

    if (line.startsWith('#')) {
      const shapeMatch = line.match(/^#\s*shape:\s*([a-z0-9-]+)\s*$/i);
      const isSurfacesMarker = /^#\s*surfaces:\s*/i.test(line);
      if (shapeMatch) {
        pendingShape = shapeMatch[1].toLowerCase();
      } else if (isSurfacesMarker) {
        // Transparent to the shape contract — does not reset pendingShape.
      } else {
        pendingShape = null;
      }
      continue;
    }

    const keyMatch = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
    if (!keyMatch) {
      pendingShape = null;
      continue;
    }

    if (pendingShape !== null) {
      entries.push({ key: keyMatch[1], shape: pendingShape });
    }
    pendingShape = null;
  }

  return entries;
}

/**
 * Canonical surface identifiers and environments for the readiness
 * doctor (scripts/env/doctor.mjs). Exported so the doctor and its tests
 * import the vocabulary from the same module that parses the manifest —
 * the `.env.example` file stays the single source of truth.
 *
 *   - S1 : local `.env` (values readable — shape + placeholder checked)
 *   - S2 : GitHub Actions Environment secrets/vars (names only)
 *   - S4 : Cloudflare Worker secrets (names only)
 */
export const SURFACES = Object.freeze(['S1', 'S2', 'S4']);
export const ENVIRONMENTS = Object.freeze(['staging', 'production']);

/**
 * Parse a single `# surfaces:` directive value into a normalized list of
 * `{ surface, envs }` requirements.
 *
 * Grammar (see `.env.example` header):
 *   <surface>[@<env>[,<env>]][; <surface>[@<env>,...]]
 *
 * - A surface with no `@env` suffix applies to every environment in
 *   ENVIRONMENTS (S1 is environment-agnostic, so its `envs` is `[]`).
 * - Whitespace around separators is tolerated.
 * - Unknown surfaces or envs throw, so a typo in the manifest fails loud
 *   rather than silently dropping a requirement.
 */
export function parseSurfacesDirective(value) {
  const requirements = [];
  const clauses = value
    .split(';')
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);

  for (const clause of clauses) {
    const [surfaceRaw, envsRaw] = clause.split('@').map((part) => part.trim());
    const surface = surfaceRaw.toUpperCase();
    if (!SURFACES.includes(surface)) {
      throw new Error(`unknown surface "${surfaceRaw}" in surfaces directive`);
    }

    let envs = [];
    if (surface === 'S1') {
      // Local surface is environment-agnostic; ignore any @env suffix.
      envs = [];
    } else if (envsRaw === undefined || envsRaw.length === 0) {
      envs = [...ENVIRONMENTS];
    } else {
      envs = envsRaw
        .split(',')
        .map((env) => env.trim())
        .filter((env) => env.length > 0);
      for (const env of envs) {
        if (!ENVIRONMENTS.includes(env)) {
          throw new Error(`unknown environment "${env}" in surfaces directive`);
        }
      }
    }

    requirements.push({ surface, envs });
  }

  return requirements;
}

/**
 * Parse a .env.example body into the cross-surface readiness manifest.
 *
 * Emits one entry per key that carries a `# surfaces:` marker (and/or a
 * `# shape:` marker). Each entry is
 * `{ key, shape: <name|null>, surfaces: [{ surface, envs }] }`.
 *
 * Both markers attach to the NEXT `KEY=value` line and may appear in
 * either order. A key with a `# shape:` marker but no `# surfaces:`
 * marker defaults to `surfaces: [{ surface: 'S1', envs: [] }]` — it is a
 * local-only check-env contract key, which is exactly the doctor's S1
 * scope. This keeps `.env.example` the single source of truth: the same
 * file feeds both check-env (via parseEnvExample) and the doctor (here).
 */
export function parseManifest(source) {
  const lines = source.split(/\r?\n/);
  const entries = [];
  let pendingShape = null;
  let pendingSurfaces = null;

  const reset = () => {
    pendingShape = null;
    pendingSurfaces = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line.length === 0) {
      reset();
      continue;
    }

    if (line.startsWith('#')) {
      const shapeMatch = line.match(/^#\s*shape:\s*([a-z0-9-]+)\s*$/i);
      const surfacesMatch = line.match(/^#\s*surfaces:\s*(.+?)\s*$/i);
      if (shapeMatch) {
        pendingShape = shapeMatch[1].toLowerCase();
      } else if (surfacesMatch) {
        pendingSurfaces = parseSurfacesDirective(surfacesMatch[1]);
      } else {
        reset();
      }
      continue;
    }

    const keyMatch = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
    if (!keyMatch) {
      reset();
      continue;
    }

    if (pendingShape !== null || pendingSurfaces !== null) {
      const surfaces = pendingSurfaces !== null ? pendingSurfaces : [{ surface: 'S1', envs: [] }];
      entries.push({ key: keyMatch[1], shape: pendingShape, surfaces });
    }
    reset();
  }

  return entries;
}

/**
 * Placeholder-value detectors. S1-only: these inspect the LOCAL `.env`
 * value's *shape* to catch the "present-but-placeholder" failure mode
 * (a `pk_test_…` key, a dummy DSN, an empty string) that passes a
 * name-only presence check but fails at runtime. The detector receives
 * the value and returns a short reason string when it looks like a
 * placeholder, or `null` when it looks real. It NEVER returns or logs
 * the value itself — only a category.
 *
 * Presence ≠ correctness: this is the only surface where placeholder
 * detection is possible, because S2/S4 expose names only.
 */
const PLACEHOLDER_PATTERNS = [
  { reason: 'empty', test: (v) => v.trim().length === 0 },
  { reason: 'clerk-test-key', test: (v) => /^pk_test_/.test(v) || /^sk_test_/.test(v) },
  { reason: 'stripe-test-key', test: (v) => /^(pk|sk)_test_/.test(v) },
  {
    reason: 'example-dsn',
    test: (v) => /sentry\.example\.invalid/i.test(v) || /public@sentry/i.test(v),
  },
  {
    reason: 'literal-placeholder',
    test: (v) =>
      /placeholder/i.test(v) ||
      /^x{4,}$/i.test(v) ||
      /\bxxxx\b/i.test(v) ||
      /^(your_|replace-with|changeme|change-me|dummy)/i.test(v),
  },
  { reason: 'all-zero-account-id', test: (v) => /^0{32}$/.test(v) },
];

/**
 * Detect whether an S1 (local) value looks like a placeholder rather
 * than a real credential. Returns `{ placeholder: true, reason }` or
 * `{ placeholder: false }`. Pure and value-shape-only — the caller is
 * responsible for never echoing the value; this helper only returns a
 * category label.
 */
export function detectPlaceholder(value) {
  if (typeof value !== 'string') {
    return { placeholder: false };
  }
  for (const { reason, test } of PLACEHOLDER_PATTERNS) {
    if (test(value)) {
      return { placeholder: true, reason };
    }
  }
  return { placeholder: false };
}

/**
 * Validate an env object against the parsed example entries.
 *
 * Returns an array of `{ key, reason, shape? }` failures. An empty array
 * means the env is valid.
 */
export function validateEnv(entries, env) {
  const failures = [];

  for (const { key, shape } of entries) {
    const value = env[key];

    if (value === undefined || value === '') {
      failures.push({ key, reason: 'missing' });
      continue;
    }

    const validator = SHAPES[shape];
    if (!validator) {
      failures.push({ key, reason: 'unknown-shape', shape });
      continue;
    }

    if (!validator(value)) {
      failures.push({ key, reason: 'shape-mismatch', shape });
    }
  }

  return failures;
}

function formatFailure(failure) {
  switch (failure.reason) {
    case 'missing':
      return `  - ${failure.key}: missing required value`;
    case 'shape-mismatch':
      return `  - ${failure.key}: value does not satisfy shape "${failure.shape}"`;
    case 'unknown-shape':
      return `  - ${failure.key}: declared shape "${failure.shape}" is not registered`;
    default:
      return `  - ${failure.key}: ${failure.reason}`;
  }
}

export function defaultExamplePath() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '.env.example');
}

/**
 * Read and parse the cross-surface manifest from a .env.example file.
 * Thin filesystem wrapper around parseManifest so the doctor can pull
 * the manifest from the canonical file with one call. Pure parse logic
 * stays in parseManifest for direct unit testing.
 */
export function loadManifest({ examplePath = defaultExamplePath() } = {}) {
  const source = readFileSync(examplePath, 'utf8');
  return parseManifest(source);
}

/**
 * Run the validator against an .env.example file and an env object.
 * Pure (no process I/O) so the unit tests can drive it directly.
 */
export function checkEnv({ examplePath, env }) {
  const source = readFileSync(examplePath, 'utf8');
  const entries = parseEnvExample(source);
  const failures = validateEnv(entries, env);
  return { entries, failures };
}

function runSelfTest() {
  const synthetic = [
    '# shape: nonempty',
    'NODE_ENV=development',
    '# shape: url',
    'SENTRY_DSN=https://example.invalid/1',
    '# shape: url',
    'DATABASE_URL=https://db.example.invalid',
    '# shape: nonempty',
    'CLOUDFLARE_API_TOKEN=abc',
    '# shape: cloudflare-account-id',
    'CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef',
    '# shape: nonempty',
    'SENTRY_AUTH_TOKEN=stoken',
  ].join('\n');

  const entries = parseEnvExample(synthetic);
  const goodEnv = {
    NODE_ENV: 'production',
    SENTRY_DSN: 'https://abc@sentry.example.invalid/123',
    DATABASE_URL: 'https://db.example.invalid/path',
    CLOUDFLARE_API_TOKEN: 'token-value',
    CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    SENTRY_AUTH_TOKEN: 'secret',
  };

  const goodFailures = validateEnv(entries, goodEnv);
  if (goodFailures.length !== 0) {
    process.stderr.write(
      `check-env self-test FAILED: expected clean env to validate, got:\n${goodFailures
        .map(formatFailure)
        .join('\n')}\n`,
    );
    process.exit(1);
  }

  const badEnv = { ...goodEnv, SENTRY_DSN: 'not-a-url', NODE_ENV: undefined };
  const badFailures = validateEnv(entries, badEnv);
  const hasMissing = badFailures.some((f) => f.key === 'NODE_ENV' && f.reason === 'missing');
  const hasShape = badFailures.some((f) => f.key === 'SENTRY_DSN' && f.reason === 'shape-mismatch');
  if (!hasMissing || !hasShape) {
    process.stderr.write(
      `check-env self-test FAILED: expected NODE_ENV missing + SENTRY_DSN shape mismatch, got:\n${badFailures
        .map(formatFailure)
        .join('\n')}\n`,
    );
    process.exit(1);
  }

  process.stdout.write('check-env self-test OK\n');
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const examplePath = defaultExamplePath();
  const { failures } = checkEnv({ examplePath, env: process.env });

  if (failures.length > 0) {
    process.stderr.write(
      `check-env: ${failures.length} validation failure(s):\n${failures
        .map(formatFailure)
        .join('\n')}\n`,
    );
    process.exit(1);
  }

  process.stdout.write('check-env: every required key present and shape-valid\n');
  process.exit(0);
}

// Only run main() when invoked directly, not when imported by tests.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`;

if (invokedDirectly) {
  main();
}
