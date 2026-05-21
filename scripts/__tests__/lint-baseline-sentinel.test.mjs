// scripts/__tests__/lint-baseline-sentinel.test.mjs
//
// AC-pinning tests for the `.onboardedAt` sentinel-pattern scan
// (Story #555 / Task #570).
//
// The scan is a binary check (zero matches required) on top of the
// existing Biome/ESLint count ratchet. These tests exercise the
// `collectSentinelViolations(root)` export against synthetic tree
// fixtures so the regex, the allowlist, the test-file exclusion, and
// the comment-line exclusion can all be pinned without depending on
// the live workspace's contents.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectSentinelViolations } from '../lint-baseline.mjs';

const fixtures = [];

afterEach(() => {
  while (fixtures.length > 0) {
    const dir = fixtures.pop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; the OS will reap tmp dirs eventually.
    }
  }
});

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-baseline-sentinel-'));
  fixtures.push(root);
  return root;
}

function writeFile(root, relPath, contents) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, 'utf8');
}

describe('collectSentinelViolations', () => {
  it('passes on an empty tree', () => {
    const root = makeFixtureRoot();
    expect(collectSentinelViolations(root)).toEqual([]);
  });

  it('passes when the sanctioned accessor is the only reader', () => {
    const root = makeFixtureRoot();
    writeFile(
      root,
      'packages/shared/src/db/queries/users.ts',
      'export function getOnboardingState() { return users.onboardedAt; }\n',
    );
    expect(collectSentinelViolations(root)).toEqual([]);
  });

  it('passes when the production schema declares the column', () => {
    const root = makeFixtureRoot();
    writeFile(
      root,
      'packages/shared/src/db/schema/users.ts',
      "export const users = { onboardedAt: integer('onboarded_at') };\n",
    );
    expect(collectSentinelViolations(root)).toEqual([]);
  });

  it('flags a new file outside the accessor that reads .onboardedAt', () => {
    const root = makeFixtureRoot();
    writeFile(
      root,
      'apps/api/src/routes/v1/probe.ts',
      'export function probe(row) { return row.onboardedAt; }\n',
    );
    const violations = collectSentinelViolations(root);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: 'apps/api/src/routes/v1/probe.ts',
      line: 1,
    });
  });

  it('ignores test files (*.test.ts, *.contract.test.ts)', () => {
    const root = makeFixtureRoot();
    writeFile(
      root,
      'apps/api/src/routes/v1/onboard.test.ts',
      'expect(row.onboardedAt).toBeNull();\n',
    );
    writeFile(
      root,
      'apps/api/src/routes/v1/onboard.contract.test.ts',
      'const x = res.onboardedAt;\n',
    );
    expect(collectSentinelViolations(root)).toEqual([]);
  });

  it('ignores comment lines that mention .onboardedAt for documentation', () => {
    const root = makeFixtureRoot();
    writeFile(
      root,
      'apps/api/src/middleware/auth.ts',
      [
        '// This middleware never reads .onboardedAt directly — it routes',
        ' * .onboardedAt is the sanctioned column for the onboarding gate.',
        'export const x = 1;',
      ].join('\n'),
    );
    expect(collectSentinelViolations(root)).toEqual([]);
  });

  it('skips node_modules, dist, .worktrees, and other build dirs', () => {
    const root = makeFixtureRoot();
    writeFile(root, 'node_modules/some-pkg/src/file.ts', 'row.onboardedAt;\n');
    writeFile(root, 'apps/api/dist/index.js', 'row.onboardedAt;\n');
    writeFile(root, '.worktrees/story-9999/file.ts', 'row.onboardedAt;\n');
    expect(collectSentinelViolations(root)).toEqual([]);
  });
});
