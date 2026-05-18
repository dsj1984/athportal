// scripts/__tests__/audit-check-allowlist.test.mjs
//
// AC-pinning tests for Task #223: the IGNORED allow-list reason +
// revisit-date contract in scripts/audit-check.mjs.
//
// These tests run under the repo's Vitest `scripts` project so
// `pnpm run test` exercises them on every PR. They lock in three
// invariants from ADR-011:
//
//   1. An IGNORED entry without a non-empty `reason` fails :check with
//      an "allow-list entry incomplete" message naming the advisory ID.
//   2. An IGNORED entry with a `revisit` date in the past fails :check
//      with an "allow-list entry expired" message.
//   3. A valid IGNORED entry (non-empty reason + future revisit) is
//      accepted by the validator so it can suppress matching
//      High/Critical findings downstream.
//
// Pyramid tier: unit. `validateAllowList` is pure (input + clock → result).

import { describe, expect, it } from 'vitest';
import {
  IGNORED,
  parseRevisitDate,
  validateAllowList,
} from '../audit-check.mjs';

const FIXED_NOW = new Date('2026-05-17T00:00:00.000Z');

describe('IGNORED', () => {
  it('is an object exported by audit-check.mjs', () => {
    expect(IGNORED).toBeTypeOf('object');
    expect(IGNORED).not.toBeNull();
  });

  it('validates clean as committed (every shipped entry obeys the contract)', () => {
    const result = validateAllowList(IGNORED, FIXED_NOW);
    expect(result).toEqual({ valid: true });
  });
});

describe('parseRevisitDate', () => {
  it('parses an ISO YYYY-MM-DD date into a UTC-midnight Date', () => {
    const parsed = parseRevisitDate('2027-01-15');
    expect(parsed).not.toBeNull();
    expect(parsed?.toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });

  it('rejects non-ISO date strings', () => {
    expect(parseRevisitDate('not a date')).toBeNull();
    expect(parseRevisitDate('2027/01/15')).toBeNull();
    expect(parseRevisitDate('15-01-2027')).toBeNull();
  });

  it('rejects non-string values', () => {
    expect(parseRevisitDate(undefined)).toBeNull();
    expect(parseRevisitDate(null)).toBeNull();
    expect(parseRevisitDate(20270115)).toBeNull();
  });
});

describe('validateAllowList', () => {
  it('returns { valid: true } when every entry has reason + future revisit', () => {
    const ignored = {
      'GHSA-aaaa-bbbb-cccc': {
        reason: 'transitive in build-only dependency; not reached at runtime',
        revisit: '2027-01-15',
      },
      'GHSA-dddd-eeee-ffff': {
        reason: 'dev-only transitive; production graph unaffected',
        revisit: '2026-12-01',
      },
    };

    const result = validateAllowList(ignored, FIXED_NOW);

    expect(result).toEqual({ valid: true });
  });

  it('fails when an entry has no reason (Task #223 AC #1)', () => {
    const ignored = {
      'GHSA-bare-no-reason': {
        revisit: '2027-01-15',
      },
    };

    const result = validateAllowList(ignored, FIXED_NOW);

    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some(
          (err) =>
            err.includes('allow-list entry incomplete') &&
            err.includes('GHSA-bare-no-reason') &&
            err.includes('missing reason'),
        ),
      ).toBe(true);
    }
  });

  it('fails when reason is an empty string', () => {
    const ignored = {
      'GHSA-empty-reason': { reason: '', revisit: '2027-01-15' },
    };
    const result = validateAllowList(ignored, FIXED_NOW);
    expect(result.valid).toBe(false);
  });

  it('fails when reason is whitespace only', () => {
    const ignored = {
      'GHSA-whitespace-reason': { reason: '   \t  ', revisit: '2027-01-15' },
    };
    const result = validateAllowList(ignored, FIXED_NOW);
    expect(result.valid).toBe(false);
  });

  it('fails when revisit is in the past with an "expired" message (Task #223 AC #2)', () => {
    const ignored = {
      'GHSA-expired-revisit': {
        reason: 'transitive in build-only dependency; not reached at runtime',
        revisit: '2025-01-01',
      },
    };

    const result = validateAllowList(ignored, FIXED_NOW);

    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(
        result.errors.some(
          (err) =>
            err.includes('allow-list entry expired') &&
            err.includes('GHSA-expired-revisit') &&
            err.includes('2025-01-01'),
        ),
      ).toBe(true);
    }
  });

  it('fails when revisit equals today (strict future requirement)', () => {
    const ignored = {
      'GHSA-revisit-today': {
        reason: 'transitive; not reached',
        revisit: '2026-05-17',
      },
    };

    const result = validateAllowList(ignored, FIXED_NOW);

    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(
        result.errors.some((err) => err.includes('expired') && err.includes('GHSA-revisit-today')),
      ).toBe(true);
    }
  });

  it('fails when revisit is missing entirely', () => {
    const ignored = {
      'GHSA-no-revisit': { reason: 'transitive; not reached' },
    };
    const result = validateAllowList(ignored, FIXED_NOW);
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.errors.some((err) => err.includes('GHSA-no-revisit'))).toBe(true);
    }
  });

  it('fails when revisit is malformed (non-ISO format)', () => {
    const ignored = {
      'GHSA-bad-revisit': { reason: 'transitive', revisit: 'soon' },
    };
    const result = validateAllowList(ignored, FIXED_NOW);
    expect(result.valid).toBe(false);
  });

  it('reports all violations together rather than stopping at the first', () => {
    const ignored = {
      'GHSA-no-reason': { revisit: '2027-01-15' },
      'GHSA-expired': {
        reason: 'transitive',
        revisit: '2024-01-01',
      },
    };

    const result = validateAllowList(ignored, FIXED_NOW);

    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.errors.length).toBe(2);
      expect(result.errors.some((err) => err.includes('GHSA-no-reason'))).toBe(true);
      expect(result.errors.some((err) => err.includes('GHSA-expired'))).toBe(true);
    }
  });

  it('accepts a valid entry that will be used to suppress a matching advisory (Task #223 AC #3)', () => {
    // This test pairs with the contract surface: a well-formed entry
    // must validate clean so it can suppress an incoming High/Critical
    // finding in the partition step (covered separately in
    // audit-check.test.mjs under Task #224).
    const ignored = {
      'GHSA-valid-future': {
        reason: 'transitive in build-only dependency; documented unreachable',
        revisit: '2027-06-01',
      },
    };

    const result = validateAllowList(ignored, FIXED_NOW);

    expect(result).toEqual({ valid: true });
  });

  it('treats an empty allow-list as valid (the happy default for a fresh repo)', () => {
    expect(validateAllowList({}, FIXED_NOW)).toEqual({ valid: true });
  });

  it('rejects an entry whose value is not an object', () => {
    const ignored = /** @type {Record<string, unknown>} */ ({
      'GHSA-bare-string': 'ignore me',
    });
    const result = validateAllowList(ignored, FIXED_NOW);
    expect(result.valid).toBe(false);
  });
});
