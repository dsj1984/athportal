// packages/baselines/src/schema.ts
//
// AJV validator factory for the seven baseline kinds. The schemas
// themselves live in the `.agents/` submodule at
// `.agents/schemas/baselines/<kind>.schema.json` (ported verbatim from
// mandrel); this module loads them from disk, registers the shared
// envelope under its `$ref` filename, and compiles per-kind validators
// keyed by `BaselineKind`.
//
// Why a factory and not a top-level compile pass: the schemas live
// outside the package (under the `.agents` submodule), so consumers
// have to point us at the schemas directory at call time. The default
// in `defaultSchemaDir()` resolves to the repository's
// `.agents/schemas/baselines/` directory by walking up from the
// package — every dimension script in this repo is invoked from the
// repo root, so the walk terminates predictably.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { BASELINE_KINDS, type BaselineKind } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENVELOPE_FILENAME = 'baseline-envelope.schema.json';

/**
 * Per-kind schema filename. The names match the on-disk filenames in
 * `.agents/schemas/baselines/` so AJV's `$ref` resolution
 * (`"$ref": "baseline-envelope.schema.json"`) can find the envelope by
 * its filename after registration.
 */
const KIND_TO_SCHEMA_FILENAME: Record<BaselineKind, string> = {
  lint: 'lint.schema.json',
  coverage: 'coverage.schema.json',
  crap: 'crap.schema.json',
  maintainability: 'maintainability.schema.json',
  mutation: 'mutation.schema.json',
  lighthouse: 'lighthouse.schema.json',
  'bundle-size': 'bundle-size.schema.json',
};

/**
 * Resolve the default schemas directory by walking up from this file
 * until `.agents/schemas/baselines/` is found. The package lives at
 * `packages/baselines/src/`, so the walk terminates at the repo root.
 */
function defaultSchemaDir(): string {
  let cwd = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(cwd, '.agents', 'schemas', 'baselines');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  // Fall back to the repo-root relative path; the read will surface an
  // honest ENOENT if the submodule is absent.
  return path.resolve(__dirname, '..', '..', '..', '.agents', 'schemas', 'baselines');
}

function loadJson(absPath: string): unknown {
  const raw = readFileSync(absPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * A cached pair of (kind → compiled validator) keyed by schema
 * directory. Compilation is non-trivial (AJV has to resolve the
 * envelope $ref), so successive calls within a single dimension run
 * reuse the same compiled functions.
 */
const VALIDATOR_CACHE = new Map<string, Map<BaselineKind, ValidateFunction>>();

/**
 * Build (or reuse from cache) the per-kind AJV validators rooted at
 * the given schemas directory. Returns a function that picks the
 * validator for a given `BaselineKind`.
 *
 * AJV is configured with `strict: false` so the `$id` URLs in the
 * mandrel-ported schemas (which point at the mandrel canonical URL)
 * do not cause a strict-mode rejection. `addFormats` registers the
 * `date-time` validator the envelope's `generatedAt` field uses.
 */
export function buildValidators(schemaDir: string = defaultSchemaDir()): {
  validate: (kind: BaselineKind) => ValidateFunction;
  schemaDir: string;
} {
  const cached = VALIDATOR_CACHE.get(schemaDir);
  if (cached) return { validate: (k) => mustGet(cached, k), schemaDir };

  const envelopePath = path.join(schemaDir, ENVELOPE_FILENAME);
  const envelopeSchema = loadJson(envelopePath);

  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(envelopeSchema as object, ENVELOPE_FILENAME);

  const perKind = new Map<BaselineKind, ValidateFunction>();
  for (const kind of BASELINE_KINDS) {
    const filename = KIND_TO_SCHEMA_FILENAME[kind];
    const kindSchema = loadJson(path.join(schemaDir, filename));
    const validator = ajv.compile(kindSchema as object);
    perKind.set(kind, validator);
  }

  VALIDATOR_CACHE.set(schemaDir, perKind);
  return { validate: (k) => mustGet(perKind, k), schemaDir };
}

function mustGet(map: Map<BaselineKind, ValidateFunction>, kind: BaselineKind): ValidateFunction {
  const v = map.get(kind);
  if (!v) {
    throw new Error(
      `[@repo/baselines] no validator registered for kind="${kind}". ` +
        `Known kinds: ${BASELINE_KINDS.join(', ')}.`,
    );
  }
  return v;
}

/**
 * Format AJV errors into a single multi-line string suitable for the
 * caller to throw. Each error names the instance path, the failing
 * keyword, and AJV's verbatim message so reviewers can map the
 * complaint back to the offending JSON path without inspecting the
 * raw AJV error object.
 */
export function formatAjvErrors(validator: ValidateFunction, context: string): string {
  const errors = validator.errors ?? [];
  if (errors.length === 0) {
    return `[@repo/baselines] ${context}: validation failed with no AJV error details`;
  }
  const lines = [`[@repo/baselines] ${context}: validation failed`];
  for (const err of errors) {
    const at = err.instancePath || '<root>';
    lines.push(`  ${at} ${err.keyword}: ${err.message ?? ''}`.trimEnd());
  }
  return lines.join('\n');
}

// Re-export the schema filename map for callers that need to surface
// the on-disk artifact path (e.g. the dimension scripts emitting a
// "validated against X" diagnostic).
export { ENVELOPE_FILENAME, KIND_TO_SCHEMA_FILENAME, defaultSchemaDir };
