// scripts/__tests__/baseline-schemas.test.mjs
//
// Pins the seven per-kind baseline schemas (lint, coverage, crap,
// maintainability, mutation, lighthouse, bundle-size) ported from
// mandrel under .agents/schemas/baselines/. Each schema must:
//
//   1. Extend the shared baseline-envelope via allOf with a $ref to
//      baseline-envelope.schema.json.
//   2. Constrain its rollup '*' shape to the Tech Spec table.
//   3. Constrain its rows item shape to the Tech Spec table.
//   4. Validate a minimal envelope-shaped sample under AJV with the
//      envelope pre-loaded for $ref resolution.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_DIR = path.join(REPO_ROOT, '.agents', 'schemas', 'baselines');

function loadSchema(file) {
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
}

function buildAjv() {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  ajv.addSchema(loadSchema('baseline-envelope.schema.json'), 'baseline-envelope.schema.json');
  return ajv;
}

// Tech Spec § C — per-kind row + rollup shapes.
const KIND_CONTRACTS = [
  {
    kind: 'lint',
    file: 'lint.schema.json',
    rollupRequired: ['errorCount', 'warningCount'],
    rowsRequired: ['path', 'errorCount', 'warningCount'],
    sampleRow: { path: 'src/a.ts', errorCount: 0, warningCount: 0 },
    sampleRollup: { errorCount: 0, warningCount: 0 },
  },
  {
    kind: 'coverage',
    file: 'coverage.schema.json',
    rollupRequired: ['lines', 'branches', 'functions'],
    rowsRequired: ['path', 'lines', 'branches', 'functions'],
    sampleRow: { path: 'src/a.ts', lines: 0, branches: 0, functions: 0 },
    sampleRollup: { lines: 0, branches: 0, functions: 0 },
  },
  {
    kind: 'crap',
    file: 'crap.schema.json',
    rollupRequired: ['p50', 'p95', 'max', 'methodsAbove20'],
    rowsRequired: ['path', 'method', 'startLine', 'crap'],
    sampleRow: { path: 'src/a.ts', method: 'foo', startLine: 1, crap: 0 },
    sampleRollup: { p50: 0, p95: 0, max: 0, methodsAbove20: 0 },
  },
  {
    kind: 'maintainability',
    file: 'maintainability.schema.json',
    rollupRequired: ['min', 'p50', 'p95'],
    rowsRequired: ['path', 'mi'],
    sampleRow: { path: 'src/a.ts', mi: 80 },
    sampleRollup: { min: 0, p50: 0, p95: 0 },
  },
  {
    kind: 'mutation',
    file: 'mutation.schema.json',
    rollupRequired: ['score', 'killed', 'survived', 'noCoverage'],
    rowsRequired: ['path', 'score', 'killed', 'survived'],
    sampleRow: { path: 'src/a.ts', score: 0, killed: 0, survived: 0 },
    sampleRollup: { score: 0, killed: 0, survived: 0, noCoverage: 0 },
  },
  {
    kind: 'lighthouse',
    file: 'lighthouse.schema.json',
    rollupRequired: ['performance', 'accessibility', 'bestPractices', 'seo'],
    rowsRequired: ['route', 'performance', 'accessibility', 'bestPractices', 'seo'],
    sampleRow: {
      route: '/',
      performance: 0,
      accessibility: 0,
      bestPractices: 0,
      seo: 0,
    },
    sampleRollup: { performance: 0, accessibility: 0, bestPractices: 0, seo: 0 },
  },
  {
    kind: 'bundle-size',
    file: 'bundle-size.schema.json',
    rollupRequired: ['totalKb', 'gzippedKb'],
    rowsRequired: ['bundle', 'rawKb', 'gzippedKb'],
    sampleRow: { bundle: 'worker', rawKb: 0, gzippedKb: 0 },
    sampleRollup: { totalKb: 0, gzippedKb: 0 },
  },
];

describe('per-kind baseline schemas', () => {
  it.each(KIND_CONTRACTS)('$kind schema extends the envelope via allOf $ref', ({ file }) => {
    const schema = loadSchema(file);
    expect(Array.isArray(schema.allOf)).toBe(true);
    const ref = schema.allOf.find((entry) => entry.$ref === 'baseline-envelope.schema.json');
    expect(ref).toBeTruthy();
  });

  it.each(KIND_CONTRACTS)(
    '$kind schema constrains rollup.* to required axes %j',
    ({ file, rollupRequired }) => {
      const schema = loadSchema(file);
      const required = schema.properties?.rollup?.properties?.['*']?.required;
      expect(required).toEqual(expect.arrayContaining(rollupRequired));
    },
  );

  it.each(KIND_CONTRACTS)(
    '$kind schema constrains rows items to required fields %j',
    ({ file, rowsRequired }) => {
      const schema = loadSchema(file);
      const required = schema.properties?.rows?.items?.required;
      expect(required).toEqual(expect.arrayContaining(rowsRequired));
    },
  );

  it.each(KIND_CONTRACTS)(
    '$kind schema accepts a minimal envelope-shaped document',
    ({ kind, file, sampleRollup, sampleRow }) => {
      const ajv = buildAjv();
      const schema = loadSchema(file);
      const validate = ajv.compile(schema);

      const sample = {
        $schema: `.agents/schemas/baselines/${kind}.schema.json`,
        kernelVersion: '1.0.0',
        generatedAt: '2026-05-17T00:00:00.000Z',
        rollup: { '*': sampleRollup },
        rows: [sampleRow],
      };

      const ok = validate(sample);
      if (!ok) {
        // Surface AJV errors when the assertion fails so a future row-shape
        // drift is immediately attributable.
        // eslint-disable-next-line no-console
        console.error(`AJV errors for ${kind}:`, validate.errors);
      }
      expect(ok).toBe(true);
    },
  );

  it.each(KIND_CONTRACTS)(
    "$kind schema rejects a rollup that omits the '*' key",
    ({ kind, file, sampleRollup }) => {
      const ajv = buildAjv();
      const schema = loadSchema(file);
      const validate = ajv.compile(schema);

      const bad = {
        $schema: `.agents/schemas/baselines/${kind}.schema.json`,
        kernelVersion: '1.0.0',
        generatedAt: '2026-05-17T00:00:00.000Z',
        rollup: { 'apps/api': sampleRollup },
        rows: [],
      };

      expect(validate(bad)).toBe(false);
    },
  );
});
