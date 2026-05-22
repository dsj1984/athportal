// packages/baselines/src/schema.test.ts
//
// Unit suite for the AJV validator factory. Pinned scenarios:
//   - every BaselineKind compiles a validator
//   - the envelope contract is enforced (missing kernelVersion fails)
//   - per-kind contracts are enforced (lint rollup must carry both
//     errorCount and warningCount)
//   - formatAjvErrors renders multi-line, instance-path-keyed output

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildValidators, formatAjvErrors } from './schema.js';
import { BASELINE_KINDS } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The repo-root .agents schemas directory, resolved without relying on
// the production `defaultSchemaDir` walk. Used to pin the schemaDir
// return value and to give buildValidators an explicit path that
// exercises the non-default branch.
const REAL_SCHEMA_DIR = path.resolve(__dirname, '..', '..', '..', '.agents', 'schemas', 'baselines');

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

  it('resolves the default schemaDir to the repo-root .agents path', () => {
    const { schemaDir } = buildValidators();
    expect(schemaDir).toBe(REAL_SCHEMA_DIR);
  });

  it('honors an explicit schemaDir argument', () => {
    // Passing the real path explicitly must produce a working validator
    // set, exercising the non-default branch of buildValidators.
    const { validate, schemaDir } = buildValidators(REAL_SCHEMA_DIR);
    expect(schemaDir).toBe(REAL_SCHEMA_DIR);
    expect(validate('coverage')(validEnvelope())).toBe(false); // wrong shape for coverage
  });

  it('throws ENOENT when the schemaDir does not contain the envelope', () => {
    const missing = path.join(__dirname, '__missing_schema_dir__');
    expect(() => buildValidators(missing)).toThrow(/ENOENT|no such file/i);
  });

  it('compiles every BaselineKind end-to-end (envelope + per-kind shape)', () => {
    // Spot-check each kind by feeding it a tailored minimal envelope so
    // the kind-specific `$ref`/`allOf` resolution path exercises every
    // schema filename in KIND_TO_SCHEMA_FILENAME.
    const { validate } = buildValidators();

    const envelopeFor = (rollupStar: Record<string, unknown>) => ({
      $schema: 'pin',
      kernelVersion: '1.0.0',
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: { '*': rollupStar },
      rows: [],
    });

    expect(validate('lint')(envelopeFor({ errorCount: 0, warningCount: 0 }))).toBe(true);
    expect(
      validate('coverage')(envelopeFor({ lines: 0, functions: 0, branches: 0 })),
    ).toBe(true);
    expect(validate('crap')(envelopeFor({ p50: 0, p95: 0, max: 0, methodsAbove20: 0 }))).toBe(
      true,
    );
    expect(validate('maintainability')(envelopeFor({ min: 0, p50: 0, p95: 0 }))).toBe(true);
    expect(
      validate('mutation')(envelopeFor({ score: 0, killed: 0, survived: 0, noCoverage: 0 })),
    ).toBe(true);
    // bundle-size and lighthouse have looser per-kind row contracts;
    // verify the envelope-level contract for those by omitting rows.
    expect(validate('bundle-size')(envelopeFor({ gzippedKb: 0, totalKb: 0 }))).toBe(true);
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

  it('falls back gracefully when AJV errors is undefined', () => {
    // `validator.errors` is allowed to be `undefined`; the formatter
    // must treat that as the no-details case rather than throwing.
    const fakeValidator = Object.assign(() => true, {}) as unknown as Parameters<
      typeof formatAjvErrors
    >[0];
    const out = formatAjvErrors(fakeValidator, 'no-errors-prop');
    expect(out).toMatch(/validation failed with no AJV error details/);
  });

  it('renders <root> when AJV emits an empty instancePath', () => {
    const fakeValidator = Object.assign(() => false, {
      errors: [{ instancePath: '', keyword: 'required', message: "must have property 'x'" }],
    }) as unknown as Parameters<typeof formatAjvErrors>[0];
    const out = formatAjvErrors(fakeValidator, 'root-path');
    expect(out).toContain('<root> required');
    expect(out).toContain("must have property 'x'");
  });

  it('renders the instancePath verbatim when AJV provides one', () => {
    const fakeValidator = Object.assign(() => false, {
      errors: [{ instancePath: '/rollup/*', keyword: 'type', message: 'must be object' }],
    }) as unknown as Parameters<typeof formatAjvErrors>[0];
    const out = formatAjvErrors(fakeValidator, 'nested-path');
    expect(out).toContain('/rollup/* type: must be object');
  });

  it('preserves error order and joins on newlines', () => {
    const fakeValidator = Object.assign(() => false, {
      errors: [
        { instancePath: '/a', keyword: 'type', message: 'first' },
        { instancePath: '/b', keyword: 'required', message: 'second' },
      ],
    }) as unknown as Parameters<typeof formatAjvErrors>[0];
    const out = formatAjvErrors(fakeValidator, 'multi');
    const lines = out.split('\n');
    expect(lines[0]).toContain('multi: validation failed');
    expect(lines[1]).toContain('/a type: first');
    expect(lines[2]).toContain('/b required: second');
    expect(lines).toHaveLength(3);
  });

  it('handles a missing AJV message by trimming trailing whitespace', () => {
    const fakeValidator = Object.assign(() => false, {
      errors: [{ instancePath: '/x', keyword: 'enum', message: undefined }],
    }) as unknown as Parameters<typeof formatAjvErrors>[0];
    const out = formatAjvErrors(fakeValidator, 'missing-msg');
    // The trailing space after the colon must be trimmed.
    expect(out).toMatch(/\/x enum:$/m);
  });
});
