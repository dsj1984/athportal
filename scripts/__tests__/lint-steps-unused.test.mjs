// scripts/__tests__/lint-steps-unused.test.mjs
//
// Pins the unused-step pass: when a defined Given/When/Then phrase has zero
// matching scenario lines in the corpus, the linter emits a WARNING
// (not an error). This stays a warning during normal development per
// docs/testing-strategy.md and becomes an error at Epic close.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lintCorpus } from '../lint-steps.mjs';

describe('lint-steps unused-step pass', () => {
  let tmpDir;
  let stepFilePath;
  let featureFilePath;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'lint-steps-unused-'));
    stepFilePath = path.join(tmpDir, 'orphan.steps.ts');
    featureFilePath = path.join(tmpDir, 'corpus.feature');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits a warning (not an error) when a phrase has zero matching scenarios', () => {
    writeFileSync(
      stepFilePath,
      [
        "import { createBdd } from 'playwright-bdd';",
        'const { Given } = createBdd();',
        "Given('I am a step nobody references', async () => { /* no-op */ });",
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      featureFilePath,
      [
        'Feature: Sample',
        '  Scenario: Mismatched',
        '    Given I take a totally different action',
        '',
      ].join('\n'),
      'utf8',
    );

    const report = lintCorpus({
      stepFiles: [stepFilePath],
      featureFiles: [featureFilePath],
      checkUnused: true,
    });

    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0].code).toBe('unused-step');
    expect(report.warnings[0].phrase).toBe('I am a step nobody references');
  });

  it('does NOT warn when a defined phrase matches at least one scenario line', () => {
    writeFileSync(
      stepFilePath,
      [
        "import { createBdd } from 'playwright-bdd';",
        'const { When } = createBdd();',
        "When('I open the {word} page', async () => { /* no-op */ });",
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      featureFilePath,
      ['Feature: Sample', '  Scenario: Match', '    When I open the welcome page', ''].join('\n'),
      'utf8',
    );

    const report = lintCorpus({
      stepFiles: [stepFilePath],
      featureFiles: [featureFilePath],
      checkUnused: true,
    });

    expect(report.errors).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });
});
