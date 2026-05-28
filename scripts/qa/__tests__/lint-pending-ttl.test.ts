// scripts/qa/__tests__/lint-pending-ttl.test.ts
//
// Unit tests for the @pending TTL gate in `scripts/qa/lint.mjs`.
//
// All tests inject a `resolveDateFn` override so no real git subprocess is
// spawned. The three paths under test are:
//   1. over-TTL — @pending scenario has been open longer than the threshold
//   2. missing-@issue-tag — @pending scenario lacks an @issue-<number> co-tag
//   3. under-TTL with @issue-tag — valid; no violation expected
//
// Citation: Story #1007 acceptance criteria.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runLint, scanAllPendingFeatures, scanPendingInFeatureFile } from '../lint.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Feature with a single @pending scenario that has no @issue-<number> tag */
const PENDING_NO_ISSUE = `@epic-99 @domain-test
Feature: Test feature

  @pending @ac-1
  Scenario: Something that is pending
    Given something
    Then something else
`;

/** Feature with a @pending scenario that also carries an @issue-123 tag */
const PENDING_WITH_ISSUE = `@epic-99 @domain-test
Feature: Test feature

  @pending @ac-1 @issue-123
  Scenario: Something that is pending with tracking issue
    Given something
    Then something else
`;

/** Feature with no @pending scenarios — should produce no violations */
const NO_PENDING = `@epic-99 @domain-test
Feature: Test feature

  @ac-1
  Scenario: A clean implemented scenario
    Given something
    Then something else
`;

/** Feature with @pending at the Feature level (not just scenario) */
const FEATURE_LEVEL_PENDING = `@pending @epic-99
Feature: Entire feature is pending

  @ac-1
  Scenario: A scenario under a pending feature
    Given something
    Then something else
`;

// ---------------------------------------------------------------------------
// Date helpers
//
// The injectable `resolveDateFn` signature is:
//   (filePath: string, repoRoot: string) => Promise<Date>
// We return a Date that is a known number of days in the past.
// ---------------------------------------------------------------------------

/** Returns a resolveDateFn that reports the file was first seen `daysAgo` days ago */
function fakeDateFn(daysAgo: number) {
  return async (_filePath: string, _repoRoot: string): Promise<Date> => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d;
  };
}

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'lint-qa-pending-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeFeature(name: string, content: string): Promise<string> {
  const abs = path.join(tmpDir, name);
  await writeFile(abs, content, 'utf8');
  return abs;
}

// ---------------------------------------------------------------------------
// scanPendingInFeatureFile — unit tests
// ---------------------------------------------------------------------------

describe('scanPendingInFeatureFile — over-TTL', () => {
  it('emits an over-ttl violation when the file age exceeds the TTL', async () => {
    const file = await writeFeature('overdue.feature', PENDING_NO_ISSUE);
    const violations = await scanPendingInFeatureFile(
      file,
      tmpDir,
      30,
      fakeDateFn(60), // 60 days old → over the 30-day TTL
    );

    const overTtl = violations.filter((v) => v.kind === 'over-ttl');
    expect(overTtl.length).toBeGreaterThanOrEqual(1);
    expect(overTtl[0].scenario).toBe('Something that is pending');
    expect(overTtl[0].ageDays).toBeGreaterThan(30);
  });

  it('does NOT emit an over-ttl violation when the file age is under the TTL', async () => {
    const file = await writeFeature('fresh.feature', PENDING_NO_ISSUE);
    const violations = await scanPendingInFeatureFile(
      file,
      tmpDir,
      90,
      fakeDateFn(10), // 10 days old → under the 90-day TTL
    );

    const overTtl = violations.filter((v) => v.kind === 'over-ttl');
    expect(overTtl).toHaveLength(0);
  });
});

describe('scanPendingInFeatureFile — missing @issue-tag', () => {
  it('emits a missing-issue-tag violation when @pending has no @issue-<number>', async () => {
    const file = await writeFeature('no-issue.feature', PENDING_NO_ISSUE);
    const violations = await scanPendingInFeatureFile(
      file,
      tmpDir,
      90,
      fakeDateFn(5), // well under TTL
    );

    const missingIssue = violations.filter((v) => v.kind === 'missing-issue-tag');
    expect(missingIssue.length).toBeGreaterThanOrEqual(1);
    expect(missingIssue[0].scenario).toBe('Something that is pending');
  });

  it('does NOT emit a missing-issue-tag violation when @issue-<number> is present', async () => {
    const file = await writeFeature('with-issue.feature', PENDING_WITH_ISSUE);
    const violations = await scanPendingInFeatureFile(file, tmpDir, 90, fakeDateFn(5));

    const missingIssue = violations.filter((v) => v.kind === 'missing-issue-tag');
    expect(missingIssue).toHaveLength(0);
  });
});

describe('scanPendingInFeatureFile — under TTL with @issue-tag (clean path)', () => {
  it('produces zero violations for a recently-added @pending with tracking issue', async () => {
    const file = await writeFeature('clean-pending.feature', PENDING_WITH_ISSUE);
    const violations = await scanPendingInFeatureFile(
      file,
      tmpDir,
      90,
      fakeDateFn(3), // 3 days old, well under TTL
    );

    expect(violations).toHaveLength(0);
  });
});

describe('scanPendingInFeatureFile — no @pending scenarios', () => {
  it('produces zero violations when no scenarios are @pending', async () => {
    const file = await writeFeature('clean.feature', NO_PENDING);
    const violations = await scanPendingInFeatureFile(
      file,
      tmpDir,
      30,
      fakeDateFn(60), // old but no @pending
    );

    expect(violations).toHaveLength(0);
  });
});

describe('scanPendingInFeatureFile — Feature-level @pending tag', () => {
  it('flags a pending Feature header for missing @issue-tag', async () => {
    const file = await writeFeature('feature-pending.feature', FEATURE_LEVEL_PENDING);
    const violations = await scanPendingInFeatureFile(file, tmpDir, 90, fakeDateFn(5));

    const missingIssue = violations.filter((v) => v.kind === 'missing-issue-tag');
    expect(missingIssue.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// scanAllPendingFeatures — directory-level tests
// ---------------------------------------------------------------------------

describe('scanAllPendingFeatures — multi-file corpus', () => {
  it('aggregates violations from multiple .feature files', async () => {
    await writeFeature('a.feature', PENDING_NO_ISSUE);
    await writeFeature('b.feature', PENDING_NO_ISSUE);

    const errors = await scanAllPendingFeatures(
      tmpDir,
      tmpDir,
      30,
      fakeDateFn(60), // over TTL → both over-ttl and missing-issue-tag per file
    );

    // Each file contributes at least one error
    const fileSet = new Set(errors.map((e) => e.file));
    expect(fileSet.size).toBe(2);
  });

  it('returns an empty array when no .feature files are present', async () => {
    const errors = await scanAllPendingFeatures(tmpDir, tmpDir, 30, fakeDateFn(60));

    expect(errors).toHaveLength(0);
  });

  it('returns an empty array when all @pending scenarios carry an @issue-tag and are under TTL', async () => {
    await writeFeature('fine.feature', PENDING_WITH_ISSUE);

    const errors = await scanAllPendingFeatures(tmpDir, tmpDir, 90, fakeDateFn(5));

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runLint — integration via the public API
// ---------------------------------------------------------------------------

describe('runLint — @pending TTL gate integration', () => {
  it('exits 1 when @pending scenarios are over TTL (no plan/charter corpus)', async () => {
    await writeFeature('overdue.feature', PENDING_NO_ISSUE);

    const code = await runLint({
      plansRoot: tmpDir, // empty — no plans here
      chartersRoot: tmpDir, // empty — no charters here
      featuresRoot: tmpDir,
      repoRoot: tmpDir,
      pendingTtlDays: 30,
      resolveDateFn: fakeDateFn(60),
    });

    expect(code).toBe(1);
  });

  it('exits 0 when the only .feature files are clean (no @pending)', async () => {
    await writeFeature('clean.feature', NO_PENDING);

    const code = await runLint({
      plansRoot: tmpDir,
      chartersRoot: tmpDir,
      featuresRoot: tmpDir,
      repoRoot: tmpDir,
      pendingTtlDays: 30,
      resolveDateFn: fakeDateFn(60),
    });

    // runLint exits 0 when corpus is empty; clean features don't add errors
    expect(code).toBe(0);
  });

  it('exits 1 when @pending scenario is missing @issue-tag even under TTL', async () => {
    await writeFeature('missing-issue.feature', PENDING_NO_ISSUE);

    const code = await runLint({
      plansRoot: tmpDir,
      chartersRoot: tmpDir,
      featuresRoot: tmpDir,
      repoRoot: tmpDir,
      pendingTtlDays: 90,
      resolveDateFn: fakeDateFn(5), // well under TTL but no issue tag
    });

    expect(code).toBe(1);
  });

  it('skips the @pending TTL scan when `paths` is provided (staged-file mode)', async () => {
    await writeFeature('overdue.feature', PENDING_NO_ISSUE);

    // When `paths` is passed, only plan/charter paths are scanned — feature
    // files are not checked, so the overdue scenario does not fail the lint.
    const code = await runLint({
      paths: [], // explicit empty list → scoped mode
      featuresRoot: tmpDir,
      repoRoot: tmpDir,
      pendingTtlDays: 30,
      resolveDateFn: fakeDateFn(60),
    });

    // Empty paths list → no plans/charters, no pending scan → exit 0
    expect(code).toBe(0);
  });
});
