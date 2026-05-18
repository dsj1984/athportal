// packages/baselines/src/schema.test.ts
//
// Unit suite for the AJV validator factory. Pinned scenarios:
//   - every BaselineKind compiles a validator
//   - the envelope contract is enforced (missing kernelVersion fails)
//   - per-kind contracts are enforced (lint rollup must carry both
//     errorCount and warningCount)
//   - formatAjvErrors renders multi-line, instance-path-keyed output

import { describe, expect, it } from 'vitest';
import { buildValidators, formatAjvErrors } from './schema.js';
import { BASELINE_KINDS } from './types.js';

function validEnvelope() {
  return {
    $schema: '.agents/schemas/baselines/lint.schema.json',
    kernelVersion: '1.0.0',
    generatedAt: '2026-05-17T00:00:00.000Z',
    rollup: { '*': { errorCount: 0, warningCount: 0 } },
    rows: [],
  };
}

function omitKey<T extends Record<string, unknown>>(obj: T, key: keyof T): Omit<T, keyof T> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== (key as string)) copy[k] = v;
  }
  return copy as Omit<T, keyof T>;
}

describe('buildValidators', () => {
  it('returns a validator factory keyed by BaselineKind for every dimension', () => {
    const { validate } = buildValidators();
    for (const kind of BASELINE_KINDS) {
      const v = validate(kind);
      expect(v).toBeTypeOf('function');
    }
  });

  it('accepts a minimal lint envelope', () => {
    const { validate } = buildValidators();
    const v = validate('lint');
    expect(v(validEnvelope())).toBe(true);
  });

  it('rejects a lint envelope missing kernelVersion', () => {
    const { validate } = buildValidators();
    const v = validate('lint');
    const bad = omitKey(validEnvelope(), 'kernelVersion');
    expect(v(bad)).toBe(false);
    expect((v.errors ?? []).some((e) => e.keyword === 'required')).toBe(true);
  });

  it('rejects a lint rollup that omits an axis', () => {
    const { validate } = buildValidators();
    const v = validate('lint');
    const base = validEnvelope();
    const starWithoutWarn = omitKey(base.rollup['*'], 'warningCount');
    const bad = { ...base, rollup: { '*': starWithoutWarn } };
    expect(v(bad)).toBe(false);
  });

  it('caches validators per schema directory', () => {
    // Calling twice returns the same compiled validator reference.
    const first = buildValidators();
    const second = buildValidators();
    expect(first.schemaDir).toBe(second.schemaDir);
    expect(first.validate('lint')).toBe(second.validate('lint'));
  });
});

describe('formatAjvErrors', () => {
  it('renders an instance-path-keyed multi-line message', () => {
    const { validate } = buildValidators();
    const v = validate('lint');
    const bad = omitKey(validEnvelope(), 'kernelVersion');
    v(bad);
    const out = formatAjvErrors(v, 'test-context');
    expect(out).toContain('test-context: validation failed');
    expect(out.split('\n').length).toBeGreaterThan(1);
  });

  it('falls back gracefully when AJV has no errors recorded', () => {
    // Synthesise a validator-shaped function with explicit empty errors
    // to exercise the no-detail branch deterministically (depending on
    // a freshly-compiled validator is racy because the suite shares the
    // module-level VALIDATOR_CACHE with earlier tests).
    const fakeValidator = Object.assign(() => true, { errors: [] }) as unknown as Parameters<
      typeof formatAjvErrors
    >[0];
    const out = formatAjvErrors(fakeValidator, 'empty-errors');
    expect(out).toMatch(/validation failed with no AJV error details/);
  });
});
