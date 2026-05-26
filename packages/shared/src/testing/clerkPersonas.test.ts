/**
 * Unit tests for `clerkPersonas.ts` — Story #881 / Task #893.
 *
 * The reader exposes a `ReadPersonaClerkIdsOptions` seam so tests can
 * inject a stub `readFile` function. The tracked `clerk-personas.json`
 * ships with all-null values; we verify every branch (populated, null,
 * missing key, malformed JSON, wrong shape, unreadable) through the
 * injected reader, never touching the real file.
 *
 * Why dependency injection over `vi.mock('node:fs')`. Vitest's
 * vmThreads pool does not reliably intercept bare-specifier imports of
 * Node built-ins (`import { readFileSync } from 'node:fs'`) when the
 * module under test is loaded through `await import()`. Passing the
 * reader as a function argument is deterministic across pool types.
 */

import { describe, expect, it } from 'vitest';

import {
  CLERK_PERSONAS,
  personaClerkIdsPath,
  personaClerkIdsRunbookPath,
  readPersonaClerkIds,
} from './clerkPersonas';

const FAKE_JSON_PATH = '/tmp/fake/clerk-personas.json';

function stubReader(contents: string): (p: string, e: 'utf8') => string {
  return () => contents;
}

function throwingReader(message: string): (p: string, e: 'utf8') => string {
  return () => {
    throw new Error(message);
  };
}

describe('CLERK_PERSONAS', () => {
  it('enumerates exactly athlete, coach, org-admin', () => {
    expect(CLERK_PERSONAS).toEqual(['athlete', 'coach', 'org-admin']);
  });

  it('is frozen so callers cannot mutate the list', () => {
    expect(Object.isFrozen(CLERK_PERSONAS)).toBe(true);
  });
});

describe('personaClerkIdsPath', () => {
  it('points at clerk-personas.json next to the reader module', () => {
    expect(personaClerkIdsPath).toMatch(/clerk-personas\.json$/);
  });

  it('is an absolute filesystem path', () => {
    // Absolute on POSIX starts with /, absolute on Windows matches drive
    // letter or UNC. Test both.
    expect(personaClerkIdsPath).toMatch(/^(\/|[A-Za-z]:[\\/]|\\\\)/);
  });
});

describe('personaClerkIdsRunbookPath', () => {
  it('points at the bootstrap runbook', () => {
    expect(personaClerkIdsRunbookPath).toBe(
      'docs/runbooks/clerk-persona-bootstrap.md',
    );
  });
});

describe('readPersonaClerkIds — happy path', () => {
  it('returns the populated subject IDs when every persona is set', () => {
    const readFile = stubReader(
      JSON.stringify({
        athlete: 'user_test_athlete_abc123',
        coach: 'user_test_coach_def456',
        'org-admin': 'user_test_orgadmin_ghi789',
      }),
    );

    const ids = readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile });

    expect(ids).toEqual({
      athlete: 'user_test_athlete_abc123',
      coach: 'user_test_coach_def456',
      'org-admin': 'user_test_orgadmin_ghi789',
    });
  });

  it('returns a frozen object so callers cannot mutate the mapping', () => {
    const readFile = stubReader(
      JSON.stringify({
        athlete: 'user_a',
        coach: 'user_b',
        'org-admin': 'user_c',
      }),
    );

    const ids = readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile });

    expect(Object.isFrozen(ids)).toBe(true);
  });
});

describe('readPersonaClerkIds — actionable error when unpopulated', () => {
  it('throws when all three personas are null', () => {
    const readFile = stubReader(
      JSON.stringify({ athlete: null, coach: null, 'org-admin': null }),
    );

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/'athlete', 'coach', 'org-admin'/);
  });

  it('throws when only one persona is still null', () => {
    const readFile = stubReader(
      JSON.stringify({
        athlete: 'user_x',
        coach: null,
        'org-admin': 'user_z',
      }),
    );

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/'coach'/);
  });

  it('throws when a persona is the empty string (treated as unpopulated)', () => {
    const readFile = stubReader(
      JSON.stringify({
        athlete: 'user_x',
        coach: '   ',
        'org-admin': 'user_z',
      }),
    );

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/'coach'/);
  });

  it('the thrown error names the operator runbook by path', () => {
    const readFile = stubReader(
      JSON.stringify({ athlete: null, coach: null, 'org-admin': null }),
    );

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/docs\/runbooks\/clerk-persona-bootstrap\.md/);
  });

  it('the thrown error includes the JSON file path so operators can locate it', () => {
    const readFile = stubReader(
      JSON.stringify({ athlete: null, coach: null, 'org-admin': null }),
    );

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/\/tmp\/fake\/clerk-personas\.json/);
  });

  it('uses the tracked clerk-personas.json path by default', () => {
    // When called with no options, the error must reference the real
    // file location next to the module so operators can find it.
    expect(() => readPersonaClerkIds()).toThrow(
      new RegExp(personaClerkIdsPath.replace(/[\\/]/g, '[\\\\/]')),
    );
  });
});

describe('readPersonaClerkIds — malformed file errors', () => {
  it('throws when the file cannot be read', () => {
    const readFile = throwingReader('ENOENT: no such file');

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/cannot read/);
  });

  it('throws when the file is not valid JSON', () => {
    const readFile = stubReader('not json at all');

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/not valid JSON/);
  });

  it('throws when the JSON root is not an object', () => {
    const readFile = stubReader(JSON.stringify(['athlete', 'coach']));

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/must be a JSON object/);
  });

  it('throws when a required key is missing', () => {
    const readFile = stubReader(
      JSON.stringify({ athlete: 'user_a', coach: 'user_b' }),
    );

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/missing the 'org-admin' key/);
  });

  it('throws when a value is the wrong type', () => {
    const readFile = stubReader(
      JSON.stringify({
        athlete: 'user_a',
        coach: 42,
        'org-admin': 'user_c',
      }),
    );

    expect(() =>
      readPersonaClerkIds({ jsonPath: FAKE_JSON_PATH, readFile }),
    ).toThrow(/'coach' must be a string or null/);
  });
});
