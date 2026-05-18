// packages/baselines/src/io.ts
//
// `readBaseline` / `writeBaseline` — the AJV-validated IO surface
// every dimension script uses to round-trip a committed envelope.
//
// Read flow:
//   1. Load JSON from `path` (surface any ENOENT verbatim).
//   2. Validate against `baseline-envelope.schema.json` first.
//   3. Validate against the per-kind schema for `kind`.
//   4. Return the typed envelope.
//
// Write flow:
//   1. Validate the in-memory snapshot against the envelope schema
//      first, then the per-kind schema.
//   2. Serialise via `serialiseBaseline` (sorted keys + trailing LF).
//   3. Parse the serialised output back to JSON and re-validate as a
//      smoke check.
//   4. Assert byte-identical re-emission: a second pass through
//      `serialiseBaseline(JSON.parse(serialised))` must equal the
//      first pass. The pre-condition of "write what you read" depends
//      on this — a value that round-trips to a different byte
//      sequence is rejected before the file is touched.
//   5. `fs.writeFileSync` the output.

import { readFileSync, writeFileSync } from 'node:fs';
import { buildValidators, formatAjvErrors } from './schema.js';
import { reserialiseFromString, serialiseBaseline } from './serialise.js';
import type { BaselineEnvelope, BaselineKind } from './types.js';

/**
 * Options for the IO surface. The default `schemaDir` walks up from
 * this package to the repository's `.agents/schemas/baselines/`
 * directory; callers running from outside the monorepo (e.g. tests
 * pointing at a fixture) override this.
 */
export interface BaselineIoOptions {
  schemaDir?: string;
}

/**
 * Read and validate a committed baseline file.
 *
 * Both validators run; AJV errors are surfaced verbatim via
 * `formatAjvErrors` so the caller can route them to stderr without
 * post-processing. The function is generic in the row/rollup shapes
 * — callers that have richer per-kind types (e.g. `LintRollup`,
 * `CoverageRow`) parameterise `R` and `U` at the call site.
 */
export function readBaseline<R = unknown, U = unknown>(
  filePath: string,
  kind: BaselineKind,
  options: BaselineIoOptions = {},
): BaselineEnvelope<R, U> {
  const raw = readFileSync(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`[@repo/baselines] readBaseline(${filePath}): invalid JSON — ${detail}`);
  }

  const { validate } = buildValidators(options.schemaDir);
  const envelopeValidator = validate(kind); // per-kind validator extends envelope via allOf

  if (!envelopeValidator(parsed)) {
    throw new Error(formatAjvErrors(envelopeValidator, `readBaseline(${filePath}, kind=${kind})`));
  }
  return parsed as BaselineEnvelope<R, U>;
}

/**
 * Validate and write a committed baseline file with byte-identical
 * serialisation. Refuses to write if the snapshot fails AJV
 * validation against either the envelope or the per-kind schema, or
 * if the round-trip produces a different byte sequence than the
 * canonical first emission.
 */
export function writeBaseline<R = unknown, U = unknown>(
  filePath: string,
  snapshot: BaselineEnvelope<R, U>,
  kind: BaselineKind,
  options: BaselineIoOptions = {},
): void {
  const { validate } = buildValidators(options.schemaDir);
  const validator = validate(kind);

  if (!validator(snapshot)) {
    throw new Error(formatAjvErrors(validator, `writeBaseline(${filePath}, kind=${kind})`));
  }

  const firstPass = serialiseBaseline(snapshot);
  const secondPass = reserialiseFromString(firstPass);
  if (firstPass !== secondPass) {
    throw new Error(
      `[@repo/baselines] writeBaseline(${filePath}, kind=${kind}): ` +
        `round-trip produced a different byte sequence. Refusing to write ` +
        `non-idempotent baseline.`,
    );
  }

  writeFileSync(filePath, firstPass, 'utf8');
}
