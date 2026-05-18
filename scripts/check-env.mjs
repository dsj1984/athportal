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
 *     `KEY=value` line. Any other comment line resets the pending shape.
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
      if (shapeMatch) {
        pendingShape = shapeMatch[1].toLowerCase();
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

function defaultExamplePath() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '.env.example');
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
