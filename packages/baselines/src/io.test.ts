// packages/baselines/src/io.test.ts
//
// Unit suite for readBaseline / writeBaseline. Pins:
//   - read of a valid envelope returns the typed shape
//   - read of an invalid envelope (missing kernelVersion) throws with
//     an AJV-formatted message
//   - write of a valid envelope produces a sorted-key, trailing-LF
//     file
//   - write rejects a snapshot that does not pass the per-kind schema
//   - read followed by write is byte-identical (round-trip stability)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBaseline, writeBaseline } from './io.js';
import { serialiseBaseline } from './serialise.js';
import type { BaselineEnvelope } from './types.js';

type LintRollup = { errorCount: number; warningCount: number };
type LintRow = { path: string; errorCount: number; warningCount: number };

function validLintEnvelope(): BaselineEnvelope<LintRow, LintRollup> {
  return {
    $schema: '.agents/schemas/baselines/lint.schema.json',
    kernelVersion: '1.0.0',
    generatedAt: '2026-05-17T00:00:00.000Z',
    rollup: { '*': { errorCount: 0, warningCount: 0 } },
    rows: [],
  };
}

function omitKey<T extends object>(obj: T, key: keyof T): Omit<T, keyof T> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== (key as string)) copy[k] = v;
  }
  return copy as Omit<T, keyof T>;
}

describe('readBaseline / writeBaseline', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'baselines-io-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('reads a valid lint envelope and returns the typed shape', () => {
    const file = path.join(tmp, 'lint.json');
    writeFileSync(file, serialiseBaseline(validLintEnvelope()), 'utf8');

    const snap = readBaseline<LintRow, LintRollup>(file, 'lint');
    expect(snap.kernelVersion).toBe('1.0.0');
    expect(snap.rollup['*'].errorCount).toBe(0);
    expect(Array.isArray(snap.rows)).toBe(true);
  });

  it('throws an AJV-formatted message when the file violates the envelope', () => {
    const file = path.join(tmp, 'lint.json');
    const bad = omitKey(validLintEnvelope(), 'kernelVersion');
    writeFileSync(file, serialiseBaseline(bad), 'utf8');

    expect(() => readBaseline(file, 'lint')).toThrow(/validation failed/);
  });

  it('throws on invalid JSON', () => {
    const file = path.join(tmp, 'lint.json');
    writeFileSync(file, '{ not json', 'utf8');
    expect(() => readBaseline(file, 'lint')).toThrow(/invalid JSON/);
  });

  it('writes a valid envelope with sorted keys + trailing LF', () => {
    const file = path.join(tmp, 'lint.json');
    writeBaseline(file, validLintEnvelope(), 'lint');

    const raw = readFileSync(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    // $schema sorts before generatedAt sorts before kernelVersion sorts
    // before rollup sorts before rows — confirm the canonical order.
    const idxSchema = raw.indexOf('"$schema"');
    const idxGen = raw.indexOf('"generatedAt"');
    const idxKernel = raw.indexOf('"kernelVersion"');
    const idxRollup = raw.indexOf('"rollup"');
    const idxRows = raw.indexOf('"rows"');
    expect(idxSchema).toBeLessThan(idxGen);
    expect(idxGen).toBeLessThan(idxKernel);
    expect(idxKernel).toBeLessThan(idxRollup);
    expect(idxRollup).toBeLessThan(idxRows);
  });

  it('refuses to write a snapshot that violates the per-kind schema', () => {
    const file = path.join(tmp, 'lint.json');
    const base = validLintEnvelope();
    // Drop the required warningCount axis — must be rejected by the
    // lint-kind schema (the envelope alone is too loose).
    const starWithoutWarn = omitKey(base.rollup['*'], 'warningCount') as unknown as LintRollup;
    const bad = { ...base, rollup: { '*': starWithoutWarn } };
    expect(() => writeBaseline(file, bad, 'lint')).toThrow(/validation failed/);
  });

  it('read → write → read round-trips byte-identically', () => {
    const file = path.join(tmp, 'lint.json');
    writeBaseline(file, validLintEnvelope(), 'lint');
    const firstBytes = readFileSync(file, 'utf8');

    const snap = readBaseline<LintRow, LintRollup>(file, 'lint');
    writeBaseline(file, snap, 'lint');
    const secondBytes = readFileSync(file, 'utf8');
    expect(secondBytes).toBe(firstBytes);
  });
});
