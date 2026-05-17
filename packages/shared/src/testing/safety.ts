/**
 * @repo/shared/testing/safety — synthetic-PII guard for test fixtures.
 *
 * Per docs/testing-strategy.md § "Forbidden Patterns", real PII must never
 * enter the test corpus. This module enforces that at the fixture boundary:
 *
 *   import { assertSyntheticPii } from '@repo/shared/testing';
 *
 *   export function seedUser(db, overrides = {}) {
 *     assertSyntheticPii(overrides);   // throws synchronously on real PII
 *     // ...
 *   }
 *
 * The guard requires every `email` field (and every `email` property nested
 * anywhere inside the overrides object) to end with `@example.invalid`. Real
 * domains such as `@example.com`, `@gmail.com`, or anything else throw a
 * typed `SyntheticPiiError` referencing the offending field path, before
 * the seed call reaches the database.
 *
 * Story #172 / Task #180.
 */

import { z } from 'zod';

const SYNTHETIC_EMAIL_SUFFIX = '@example.invalid';

/**
 * Zod schema that accepts only synthetic emails — values whose local part is
 * non-empty and whose domain is exactly `example.invalid`.
 *
 * Exported for callers that want to compose it into their own fixture
 * schemas (e.g. `z.object({ email: syntheticEmailSchema, ... })`).
 */
export const syntheticEmailSchema = z
  .string()
  .min(SYNTHETIC_EMAIL_SUFFIX.length + 1, {
    message: `email must be a synthetic value ending with ${SYNTHETIC_EMAIL_SUFFIX}`,
  })
  .endsWith(SYNTHETIC_EMAIL_SUFFIX, {
    message: `email must be a synthetic value ending with ${SYNTHETIC_EMAIL_SUFFIX}`,
  });

/**
 * Typed error thrown by `assertSyntheticPii` when an offending email is
 * detected. The `path` field uses dot/bracket notation (e.g. `members[0].email`)
 * so callers can pinpoint the violation in deeply nested fixture overrides.
 */
export class SyntheticPiiError extends Error {
  readonly path: string;
  readonly value: string;

  constructor(path: string, value: string) {
    super(
      `Synthetic-PII guard rejected ${path || '<root>'}: ` +
        `"${value}" must end with ${SYNTHETIC_EMAIL_SUFFIX}. ` +
        'Use a synthetic value (e.g. test-user-1@example.invalid) in test fixtures.',
    );
    this.name = 'SyntheticPiiError';
    this.path = path;
    this.value = value;
  }
}

type Unknown = unknown;

function isPlainObject(value: Unknown): value is Record<string, Unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function joinPath(base: string, segment: string | number): string {
  if (typeof segment === 'number') {
    return `${base}[${segment}]`;
  }
  if (base === '') {
    return segment;
  }
  return `${base}.${segment}`;
}

function walk(value: Unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      walk(item, joinPath(path, idx));
    });
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = joinPath(path, key);
    if (key === 'email') {
      if (typeof child !== 'string' || !child.endsWith(SYNTHETIC_EMAIL_SUFFIX)) {
        const display = typeof child === 'string' ? child : String(child);
        throw new SyntheticPiiError(nextPath, display);
      }
    }
    walk(child, nextPath);
  }
}

/**
 * Walk `overrides` and throw `SyntheticPiiError` if any `email` field is
 * not a synthetic value ending in `@example.invalid`.
 *
 * Idempotent and side-effect free — safe to call before any DB I/O.
 */
export function assertSyntheticPii(overrides: unknown): void {
  walk(overrides, '');
}
