// scripts/check-env.test.mjs
//
// Regression coverage for the check-env shape vocabulary. Each registered
// shape (`nonempty`, `url`, `cloudflare-account-id`) is exercised with a
// present-and-valid case, a missing case, and a malformed case. Tests
// drive the real script as a child process so that exit code and stderr
// are both observable — this is what the parent Story locks in: future
// edits cannot silently drop a shape without flipping at least one
// assertion red.
//
// Pyramid tier: unit. The validator is pure (parse + validate) and the
// child-process boundary here is the validator's own CLI surface, not an
// external service.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseEnvExample, validateEnv } from './check-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(HERE, 'check-env.mjs');

describe('parseEnvExample', () => {
  it('emits only shape-tagged keys, in source order', () => {
    const body = [
      '# shape: nonempty',
      'NODE_ENV=development',
      'UNTAGGED_LEGACY=foo',
      '# shape: url',
      'SENTRY_DSN=https://example.invalid/1',
      '# shape: cloudflare-account-id',
      'CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef',
    ].join('\n');

    const entries = parseEnvExample(body);

    assert.deepEqual(entries, [
      { key: 'NODE_ENV', shape: 'nonempty' },
      { key: 'SENTRY_DSN', shape: 'url' },
      { key: 'CLOUDFLARE_ACCOUNT_ID', shape: 'cloudflare-account-id' },
    ]);
  });

  it('resets pending shape after a non-shape comment', () => {
    const body = [
      '# shape: url',
      '# regular comment between marker and key',
      'NOT_TAGGED=value',
    ].join('\n');

    const entries = parseEnvExample(body);

    assert.deepEqual(entries, []);
  });
});

describe('validateEnv shape vocabulary', () => {
  const BASE_BODY = [
    '# shape: nonempty',
    'NODE_ENV=development',
    '# shape: url',
    'SENTRY_DSN=https://example.invalid/1',
    '# shape: cloudflare-account-id',
    'CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef',
  ].join('\n');

  it('returns no failures when every shape is satisfied', () => {
    const entries = parseEnvExample(BASE_BODY);
    const failures = validateEnv(entries, {
      NODE_ENV: 'production',
      SENTRY_DSN: 'https://abc@sentry.example.invalid/1',
      CLOUDFLARE_ACCOUNT_ID: 'deadbeef00000000deadbeef00000000',
    });
    assert.deepEqual(failures, []);
  });

  for (const shapeCase of [
    {
      shape: 'nonempty',
      key: 'NODE_ENV',
      validValue: 'production',
      malformedValue: '   ',
    },
    {
      shape: 'url',
      key: 'SENTRY_DSN',
      validValue: 'https://abc@sentry.example.invalid/1',
      malformedValue: 'not-a-url',
    },
    {
      shape: 'cloudflare-account-id',
      key: 'CLOUDFLARE_ACCOUNT_ID',
      validValue: 'deadbeef00000000deadbeef00000000',
      malformedValue: 'XYZ-not-hex',
    },
  ]) {
    it(`accepts a valid ${shapeCase.shape} value for ${shapeCase.key}`, () => {
      const entries = parseEnvExample(`# shape: ${shapeCase.shape}\n${shapeCase.key}=ignored`);
      const failures = validateEnv(entries, {
        [shapeCase.key]: shapeCase.validValue,
      });
      assert.deepEqual(failures, []);
    });

    it(`flags a missing ${shapeCase.shape} value for ${shapeCase.key}`, () => {
      const entries = parseEnvExample(`# shape: ${shapeCase.shape}\n${shapeCase.key}=ignored`);
      const failures = validateEnv(entries, {});
      assert.equal(failures.length, 1);
      assert.equal(failures[0].key, shapeCase.key);
      assert.equal(failures[0].reason, 'missing');
    });

    it(`flags a malformed ${shapeCase.shape} value for ${shapeCase.key}`, () => {
      const entries = parseEnvExample(`# shape: ${shapeCase.shape}\n${shapeCase.key}=ignored`);
      const failures = validateEnv(entries, {
        [shapeCase.key]: shapeCase.malformedValue,
      });
      assert.equal(failures.length, 1);
      assert.equal(failures[0].key, shapeCase.key);
      assert.equal(failures[0].reason, 'shape-mismatch');
      assert.equal(failures[0].shape, shapeCase.shape);
    });
  }
});

describe('check-env CLI: exit code + stderr key surfacing', () => {
  let workDir;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'check-env-cli-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function runCli({ exampleBody, env }) {
    // The script resolves `.env.example` as a sibling of `scripts/`
    // (i.e. the repo root). Mirror that layout under workDir so the
    // fixture intercepts the read without touching the real repo.
    const scriptsDir = join(workDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });

    const examplePath = join(workDir, '.env.example');
    writeFileSync(examplePath, exampleBody, 'utf8');

    const scriptCopyPath = join(scriptsDir, 'check-env.mjs');
    copyFileSync(SCRIPT_PATH, scriptCopyPath);

    return spawnSync(process.execPath, [scriptCopyPath], {
      env: { ...env, PATH: process.env.PATH },
      encoding: 'utf8',
    });
  }

  const FIXTURE = [
    '# shape: nonempty',
    'NODE_ENV=development',
    '# shape: url',
    'SENTRY_DSN=https://example.invalid/1',
    '# shape: cloudflare-account-id',
    'CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef',
  ].join('\n');

  it('exits 0 when every shape-tagged key is present and valid', () => {
    const result = runCli({
      exampleBody: FIXTURE,
      env: {
        NODE_ENV: 'production',
        SENTRY_DSN: 'https://abc@sentry.example.invalid/1',
        CLOUDFLARE_ACCOUNT_ID: 'deadbeef00000000deadbeef00000000',
      },
    });
    assert.equal(result.status, 0, `stderr was: ${result.stderr}`);
  });

  it('exits 1 and names the missing key in stderr (nonempty shape)', () => {
    const result = runCli({
      exampleBody: FIXTURE,
      env: {
        SENTRY_DSN: 'https://abc@sentry.example.invalid/1',
        CLOUDFLARE_ACCOUNT_ID: 'deadbeef00000000deadbeef00000000',
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /NODE_ENV/);
  });

  it('exits 1 and names the malformed key in stderr (url shape)', () => {
    const result = runCli({
      exampleBody: FIXTURE,
      env: {
        NODE_ENV: 'production',
        SENTRY_DSN: 'not-a-url',
        CLOUDFLARE_ACCOUNT_ID: 'deadbeef00000000deadbeef00000000',
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SENTRY_DSN/);
  });

  it('exits 1 and names the malformed key in stderr (cloudflare-account-id shape)', () => {
    const result = runCli({
      exampleBody: FIXTURE,
      env: {
        NODE_ENV: 'production',
        SENTRY_DSN: 'https://abc@sentry.example.invalid/1',
        CLOUDFLARE_ACCOUNT_ID: 'not-hex-and-too-short',
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CLOUDFLARE_ACCOUNT_ID/);
  });

  it('exits 1 and names a missing cloudflare-account-id key in stderr', () => {
    const result = runCli({
      exampleBody: FIXTURE,
      env: {
        NODE_ENV: 'production',
        SENTRY_DSN: 'https://abc@sentry.example.invalid/1',
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CLOUDFLARE_ACCOUNT_ID/);
  });
});
