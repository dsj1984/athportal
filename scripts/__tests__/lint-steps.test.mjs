// scripts/__tests__/lint-steps.test.mjs
//
// Unit tests pinning the four forbidden-pattern rules against their
// rejecting fixtures, plus the duplicate-phrase rule on the paired pair.
//
// Adding a new forbidden-pattern rule needs only:
//   1. A new fixture file under scripts/__fixtures__/lint-steps/.
//   2. A new entry in FIXTURE_EXPECTATIONS in scripts/lint-steps.mjs.
//   3. A new `it.each`-style row below — no harness changes required.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_FIXTURE_PAIR,
  FIXTURE_EXPECTATIONS,
  lintFixtureDuplicates,
  lintFixtureSingle,
} from '../lint-steps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '..', '__fixtures__', 'lint-steps');

describe('lint-steps forbidden-pattern rules', () => {
  const cases = Object.entries(FIXTURE_EXPECTATIONS);

  it.each(cases)('rejects %s with exactly the expected rule code', (fixtureName, expectedCode) => {
    const fixturePath = path.join(FIXTURE_DIR, fixtureName);
    expect(existsSync(fixturePath)).toBe(true);

    const { ok, codes, report } = lintFixtureSingle(fixturePath, expectedCode);

    // Exactly one error, exactly the expected code.
    expect(ok).toBe(true);
    expect(codes).toEqual([expectedCode]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe(expectedCode);
    expect(report.errors[0].file).toContain(fixtureName);
  });
});

describe('lint-steps duplicate-phrase rule', () => {
  it('rejects the paired duplicate fixtures with exactly [no-duplicate-phrase]', () => {
    const pairAbs = DUPLICATE_FIXTURE_PAIR.map((n) => path.join(FIXTURE_DIR, n));
    for (const p of pairAbs) {
      expect(existsSync(p)).toBe(true);
    }

    const { ok, codes, report } = lintFixtureDuplicates(pairAbs);

    expect(ok).toBe(true);
    expect(codes).toEqual(['no-duplicate-phrase']);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe('no-duplicate-phrase');
    // The error references both files in the duplicate set.
    expect(report.errors[0].message).toMatch(/duplicate-phrase-a\.steps\.ts/);
    expect(report.errors[0].message).toMatch(/duplicate-phrase-b\.steps\.ts/);
  });

  it('does NOT report a duplicate when only one half of the pair is linted alone', () => {
    const singletonAbs = path.join(FIXTURE_DIR, DUPLICATE_FIXTURE_PAIR[0]);
    // Lint via the single-fixture harness, declaring the expected code as
    // 'no-duplicate-phrase' — the call should report ok:false because in
    // isolation the fixture is clean (no duplicate partner present).
    const { codes, report } = lintFixtureSingle(singletonAbs, 'no-duplicate-phrase');
    expect(codes).toEqual([]);
    expect(report.errors).toHaveLength(0);
  });
});
