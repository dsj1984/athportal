// packages/baselines/src/types.ts
//
// Type definitions shared by the read/write/compare/format surface.
// These mirror the JSON-schema contracts in
// `.agents/schemas/baselines/` (ported verbatim from mandrel). Keep the
// two sides in lockstep when the schema evolves — the envelope shape
// itself is intentionally agnostic about row contents so the per-kind
// schemas can tighten the row shape without churning this file.

/**
 * The seven dimensions for which a per-kind baseline schema exists at
 * `.agents/schemas/baselines/<kind>.schema.json`. The order matches the
 * order documented in the Tech Spec's per-kind table.
 */
export const BASELINE_KINDS = [
  'lint',
  'coverage',
  'crap',
  'maintainability',
  'mutation',
  'lighthouse',
  'bundle-size',
] as const;

/**
 * A discriminator naming one of the seven dimensions. Used by
 * `readBaseline` / `writeBaseline` to pick the correct AJV validator.
 */
export type BaselineKind = (typeof BASELINE_KINDS)[number];

/**
 * The shared envelope contract that every committed baseline obeys.
 * Per-kind schemas extend this via `allOf` to constrain the inner
 * shape of `rollup['*']` and each `rows[]` entry — the envelope itself
 * is generic in both axes.
 *
 * - `$schema` points back to the per-kind schema for editor tooling.
 * - `kernelVersion` is the in-repo kernel semver; bumped when the
 *   scoring formula, scan shape, or rollup math changes.
 * - `generatedAt` is an ISO-8601 timestamp of the producing run.
 * - `rollup` carries aggregate metrics keyed by component. The `*`
 *   key is reserved for the whole-repo rollup and is REQUIRED.
 * - `rows` is per-row metrics; per-kind schemas pin the shape and the
 *   producing script pins the ordering for byte-identical re-emission.
 */
export interface BaselineEnvelope<Row = unknown, Rollup = unknown> {
  $schema: string;
  kernelVersion: string;
  generatedAt: string;
  rollup: { '*': Rollup } & Record<string, Rollup>;
  rows: Row[];
}

/**
 * The five tolerance kinds the harness supports. Each dimension picks
 * exactly one and configures it in the script that owns the dimension;
 * the harness does not encode policy here — it only knows how to
 * compare against a configured spec.
 *
 * - `absolute-pp` — coverage. Floor = current − `pp` percentage points.
 * - `relative-pct` — crap, mutation. Allow `pct`% relative drift on
 *   each row's metric.
 * - `absolute-int` — lint warnings (net), MI floor. Integer-valued
 *   delta tolerance.
 * - `hard-cap` — bundle size. Fail at `cap`; warn at `warnPct * cap`
 *   (`0 < warnPct <= 1`). Matches the 1 MiB Worker contract.
 * - `route-band` — lighthouse. Allow ±`plusMinus` per metric per
 *   route.
 */
export type ToleranceSpec =
  | { kind: 'absolute-pp'; pp: number }
  | { kind: 'relative-pct'; pct: number }
  | { kind: 'absolute-int'; delta: number }
  | { kind: 'hard-cap'; cap: number; warnPct: number }
  | { kind: 'route-band'; plusMinus: number };

/**
 * Severity of a single tolerance Diff entry. `warn` is reserved for
 * the bundle-size `hard-cap` 90%-of-cap signal; every other tolerance
 * kind only emits `fail` entries.
 */
export type DiffSeverity = 'warn' | 'fail';

/**
 * A single row's tolerance violation, returned by `compareWithTolerance`.
 * The harness emits one `Diff` per row whose measurement falls outside
 * the configured tolerance; conformance yields an empty array.
 *
 * - `identifier` is the row's natural key (`path` for code-shaped
 *   dimensions, `route` for lighthouse, `bundle` for bundle-size,
 *   `*` for rollup-only violations).
 * - `axis` is the per-kind metric name that fell out of tolerance
 *   (e.g. `lines` for coverage, `score` for mutation, `gzippedKb` for
 *   bundle-size).
 * - `prev` / `next` carry the raw measurement values that produced the
 *   violation. `formatRejectionMessage` renders them verbatim.
 * - `tolerance` is the spec that was applied — included on the Diff so
 *   the rejection message can name the policy that fired.
 * - `severity` is `warn` for sub-cap bundle-size signals and `fail`
 *   everywhere else.
 */
export interface Diff<Row = unknown> {
  identifier: string;
  axis: string;
  prev: number;
  next: number;
  tolerance: ToleranceSpec;
  severity: DiffSeverity;
  /** Optional pointer back to the offending row, if applicable. */
  row?: Row;
}
