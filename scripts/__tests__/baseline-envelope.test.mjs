// scripts/__tests__/baseline-envelope.test.mjs
//
// Pins the shared baseline envelope contract that every per-kind
// baseline schema (lint, coverage, crap, maintainability, mutation,
// lighthouse, bundle-size) extends via allOf. The envelope is hosted
// in the .agents submodule (ported from mandrel) and is the schema all
// committed baselines validate against first.
//
// This test enforces the acceptance criteria captured under task #228:
//   - $schema, kernelVersion, generatedAt, rollup, rows are required
//   - kernelVersion constrains to ^[0-9]+\.[0-9]+\.[0-9]+$
//   - rollup declares '*' as required, with additionalProperties: true

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ENVELOPE_PATH = path.join(
  REPO_ROOT,
  '.agents',
  'schemas',
  'baselines',
  'baseline-envelope.schema.json',
);

function loadEnvelopeSchema() {
  const raw = readFileSync(ENVELOPE_PATH, 'utf8');
  return JSON.parse(raw);
}

describe('baseline envelope schema', () => {
  it('exists at .agents/schemas/baselines/baseline-envelope.schema.json', () => {
    const schema = loadEnvelopeSchema();
    expect(schema).toBeTypeOf('object');
    expect(schema.title).toBe('BaselineEnvelope');
  });

  it('lists $schema, kernelVersion, generatedAt, rollup, rows as required top-level fields', () => {
    const schema = loadEnvelopeSchema();
    expect(schema.required).toEqual(
      expect.arrayContaining(['$schema', 'kernelVersion', 'generatedAt', 'rollup', 'rows']),
    );
  });

  it('constrains kernelVersion to the semver pattern', () => {
    const schema = loadEnvelopeSchema();
    expect(schema.properties.kernelVersion.pattern).toBe('^[0-9]+\\.[0-9]+\\.[0-9]+$');
  });

  it('declares rollup.* as required with additionalProperties: true', () => {
    const schema = loadEnvelopeSchema();
    const rollup = schema.properties.rollup;
    expect(rollup.required).toEqual(expect.arrayContaining(['*']));
    expect(rollup.additionalProperties).toBe(true);
  });

  it('compiles under AJV (strict:false to permit the $id pointer)', () => {
    const schema = loadEnvelopeSchema();
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate).toBeTypeOf('function');
  });

  it('validates a minimal envelope-shaped document', () => {
    const schema = loadEnvelopeSchema();
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const sample = {
      $schema: '.agents/schemas/baselines/lint.schema.json',
      kernelVersion: '1.0.0',
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: { '*': { errorCount: 0, warningCount: 0 } },
      rows: [],
    };

    expect(validate(sample)).toBe(true);
  });

  it('rejects a kernelVersion that is not semver', () => {
    const schema = loadEnvelopeSchema();
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const bad = {
      $schema: '.agents/schemas/baselines/lint.schema.json',
      kernelVersion: 'v1',
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: { '*': {} },
      rows: [],
    };

    expect(validate(bad)).toBe(false);
  });

  it("rejects a rollup that omits the required '*' key", () => {
    const schema = loadEnvelopeSchema();
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    const bad = {
      $schema: '.agents/schemas/baselines/lint.schema.json',
      kernelVersion: '1.0.0',
      generatedAt: '2026-05-17T00:00:00.000Z',
      rollup: { 'apps/api': { errorCount: 0, warningCount: 0 } },
      rows: [],
    };

    expect(validate(bad)).toBe(false);
  });
});
