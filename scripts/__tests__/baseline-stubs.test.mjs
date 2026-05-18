// scripts/__tests__/baseline-stubs.test.mjs
//
// Pins the existing baselines/crap.json and baselines/maintainability.json
// stubs to the envelope contract (Task #226). These two stubs were rewritten
// from the legacy flat shape (escomplex-version metadata, empty object) to
// the envelope shape so they validate against the per-kind schemas hosted
// at .agents/schemas/baselines/.
//
// Invariants enforced here:
//   1. Both files validate against the envelope and their per-kind schema
//      under AJV.
//   2. Files remain pre-primed (empty rows[]; rollup '*' values are 0
//      placeholders) so the operator's first `<dim>:update` populates real
//      measurements. This guards against an accidental hand-edit drifting
//      either file off the unprimed contract.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_DIR = path.join(REPO_ROOT, '.agents', 'schemas', 'baselines');
const BASELINES_DIR = path.join(REPO_ROOT, 'baselines');

function loadJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function buildAjv() {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  ajv.addSchema(
    loadJson(path.join(SCHEMA_DIR, 'baseline-envelope.schema.json')),
    'baseline-envelope.schema.json',
  );
  return ajv;
}

const STUBS = [
  {
    kind: 'crap',
    file: 'crap.json',
    schemaFile: 'crap.schema.json',
    rollupAxes: ['p50', 'p95', 'max', 'methodsAbove20'],
  },
  {
    kind: 'maintainability',
    file: 'maintainability.json',
    schemaFile: 'maintainability.schema.json',
    rollupAxes: ['min', 'p50', 'p95'],
  },
];

describe('baseline stubs (crap + maintainability)', () => {
  it.each(STUBS)('$kind stub carries an envelope-shaped document', ({ file }) => {
    const doc = loadJson(path.join(BASELINES_DIR, file));
    expect(doc).toHaveProperty('$schema');
    expect(doc).toHaveProperty('kernelVersion');
    expect(doc).toHaveProperty('generatedAt');
    expect(doc).toHaveProperty('rollup');
    expect(doc).toHaveProperty('rows');
  });

  it.each(STUBS)('$kind stub pins kernelVersion to 1.0.0', ({ file }) => {
    const doc = loadJson(path.join(BASELINES_DIR, file));
    expect(doc.kernelVersion).toBe('1.0.0');
  });

  it.each(STUBS)("$kind stub rollup carries the required '*' key", ({ file }) => {
    const doc = loadJson(path.join(BASELINES_DIR, file));
    expect(doc.rollup).toHaveProperty('*');
    expect(typeof doc.rollup['*']).toBe('object');
  });

  it.each(STUBS)('$kind stub rollup * declares every required axis', ({ file, rollupAxes }) => {
    const doc = loadJson(path.join(BASELINES_DIR, file));
    for (const axis of rollupAxes) {
      expect(doc.rollup['*']).toHaveProperty(axis);
    }
  });

  it.each(STUBS)('$kind stub ships unprimed (rows[] empty)', ({ file }) => {
    const doc = loadJson(path.join(BASELINES_DIR, file));
    expect(Array.isArray(doc.rows)).toBe(true);
    expect(doc.rows).toHaveLength(0);
  });

  it.each(STUBS)(
    "$kind stub rollup * values are zero placeholders (operator's first :update primes them)",
    ({ file, rollupAxes }) => {
      const doc = loadJson(path.join(BASELINES_DIR, file));
      for (const axis of rollupAxes) {
        expect(doc.rollup['*'][axis]).toBe(0);
      }
    },
  );

  it.each(STUBS)(
    '$kind stub validates under AJV against its per-kind schema',
    ({ file, schemaFile }) => {
      const ajv = buildAjv();
      const schema = loadJson(path.join(SCHEMA_DIR, schemaFile));
      const validate = ajv.compile(schema);
      const doc = loadJson(path.join(BASELINES_DIR, file));
      const ok = validate(doc);
      if (!ok) {
        // eslint-disable-next-line no-console
        console.error(`AJV errors for ${file}:`, validate.errors);
      }
      expect(ok).toBe(true);
    },
  );

  it.each(STUBS)(
    "$kind stub's $schema pointer targets the matching per-kind schema",
    ({ file, schemaFile }) => {
      const doc = loadJson(path.join(BASELINES_DIR, file));
      expect(doc.$schema).toBe(`.agents/schemas/baselines/${schemaFile}`);
    },
  );
});
