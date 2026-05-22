// packages/baselines/src/serialise.test.ts
//
// Unit suite for the stable JSON serialiser. Pins:
//   - lexicographic key ordering at every depth
//   - trailing newline
//   - byte-identical round-trip via reserialiseFromString
//   - empty array / empty object short forms

import { describe, expect, it } from 'vitest';
import { reserialiseFromString, serialiseBaseline } from './serialise.js';

describe('serialiseBaseline', () => {
  it('sorts top-level keys lexicographically', () => {
    const out = serialiseBaseline({ b: 1, a: 2 });
    expect(out).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });

  it('sorts nested keys at every depth', () => {
    const out = serialiseBaseline({ z: { c: 1, a: 2 }, a: { y: 1, b: 2 } });
    // Top: a then z; nested-a: b then y; nested-z: a then c.
    expect(out).toContain('"a": {\n    "b": 2,\n    "y": 1\n  }');
    expect(out).toContain('"z": {\n    "a": 2,\n    "c": 1\n  }');
  });

  it('preserves array ordering — caller owns row order', () => {
    const out = serialiseBaseline({ rows: [3, 1, 2] });
    expect(out).toContain('"rows": [\n    3,\n    1,\n    2\n  ]');
  });

  it('emits a trailing LF newline', () => {
    const out = serialiseBaseline({ a: 1 });
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('}\n\n')).toBe(false);
  });

  it('short-forms empty array and empty object', () => {
    expect(serialiseBaseline([])).toBe('[]\n');
    expect(serialiseBaseline({})).toBe('{}\n');
  });

  it('round-trips byte-identically via reserialiseFromString', () => {
    const snap = {
      $schema: '.agents/schemas/baselines/lint.schema.json',
      kernelVersion: '1.0.0',
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: { '*': { errorCount: 0, warningCount: 0 } },
      rows: [
        { path: 'apps/api/src/a.ts', errorCount: 0, warningCount: 1 },
        { path: 'apps/web/src/b.ts', errorCount: 0, warningCount: 2 },
      ],
    };
    const first = serialiseBaseline(snap);
    const second = reserialiseFromString(first);
    expect(second).toBe(first);
  });

  it('rejects non-finite numbers', () => {
    expect(() => serialiseBaseline({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite number/);
    expect(() => serialiseBaseline({ x: Number.NaN })).toThrow(/non-finite number/);
  });

  it('rejects unsupported types (functions, undefined)', () => {
    expect(() => serialiseBaseline(undefined)).toThrow();
    expect(() => serialiseBaseline({ fn: () => 1 })).toThrow();
  });

  it('serialises primitive scalars verbatim', () => {
    expect(serialiseBaseline(null)).toBe('null\n');
    expect(serialiseBaseline(true)).toBe('true\n');
    expect(serialiseBaseline(false)).toBe('false\n');
    expect(serialiseBaseline(0)).toBe('0\n');
    expect(serialiseBaseline(1.5)).toBe('1.5\n');
    expect(serialiseBaseline('hello')).toBe('"hello"\n');
  });

  it('escapes special characters in string keys and values', () => {
    const out = serialiseBaseline({ 'a"b': 'c\nd' });
    // JSON.stringify handles the escaping; we only assert the result
    // is parseable and round-trips.
    expect(reserialiseFromString(out)).toBe(out);
  });

  it('rejects negative-infinity explicitly', () => {
    expect(() => serialiseBaseline({ x: Number.NEGATIVE_INFINITY })).toThrow(/non-finite/);
  });
});
