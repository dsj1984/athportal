// packages/baselines/src/compare.ts
//
// `compareWithTolerance` — the per-dimension tolerance comparison
// engine. Given a previous and next envelope plus a `ToleranceSpec`,
// returns one `Diff` per row whose measurement exceeds tolerance.
// An empty array means conformance.
//
// Tolerance semantics (one branch per `ToleranceSpec.kind`):
//
//   absolute-pp     — "next must not be more than `pp` percentage
//                     points below prev". Direction is policy-driven:
//                     for coverage (the canonical caller), prev is a
//                     floor and a `next - prev` delta below `-pp`
//                     fails.
//   relative-pct    — "next must not be more than `pct`% worse than
//                     prev". For directional metrics like mutation
//                     score (higher is better) and CRAP (lower is
//                     better), the caller's row contract names the
//                     axis and the comparator picks the right
//                     polarity per dimension (see below).
//   absolute-int    — "next must not be more than `delta` worse than
//                     prev". Integer-only.
//   hard-cap        — "next must not exceed `cap`. Warn at
//                     `warnPct * cap`." Emits `severity: 'warn'` at
//                     the warn threshold and `severity: 'fail'` at
//                     or above the cap.
//   route-band      — "next must be within ±`plusMinus` of prev".
//                     Lighthouse-shaped: both directions are caught.
//
// Polarity. Per-axis polarity (higher-is-better vs lower-is-better)
// is dimension-specific. The harness encodes the two standard
// polarities via the `RowComparator` plumbing and exposes
// `compareWithTolerance` as a thin wrapper that picks the
// appropriate comparator per `ToleranceSpec.kind`. Dimension scripts
// that need richer per-row picking (e.g. a custom row identifier or
// per-axis polarity) compose `extractDiffs` directly.

import type { BaselineEnvelope, Diff, ToleranceSpec } from './types.js';

/**
 * Shape of a row that the comparator can inspect — a record that
 * carries an identifier under a configurable key (`path`, `route`,
 * `bundle`) and one or more numeric axes.
 *
 * The harness is intentionally permissive about the row shape so the
 * seven dimensions can share this engine without the engine knowing
 * each schema's keys at the type level. AJV validation at read time
 * is what enforces the per-kind shape; once a row is in hand here,
 * it has already been schema-validated and we only need to inspect
 * the axes named by the caller.
 */
export type Row = Record<string, unknown>;

/**
 * Per-tolerance-kind configuration. Each dimension script picks one.
 *
 * - `identifierKey` — the row field that uniquely names the row
 *   (`path` for code-shaped, `route` for lighthouse, `bundle` for
 *   bundle-size, defaults to `path` if unspecified).
 * - `axes` — the numeric row fields to compare. The harness emits
 *   one `Diff` per axis that fell out of tolerance, per row.
 * - `polarity` — `'higher-is-better'` for axes where a drop is bad
 *   (mutation score, coverage, lighthouse) or
 *   `'lower-is-better'` for axes where a rise is bad (lint warnings,
 *   CRAP, bundle size). Required for `absolute-pp`, `relative-pct`,
 *   `absolute-int`.
 */
export interface CompareConfig {
  identifierKey?: string;
  axes: readonly string[];
  polarity?: 'higher-is-better' | 'lower-is-better';
}

type Polarity = NonNullable<CompareConfig['polarity']>;
type Severity = 'fail' | 'warn';

/**
 * Compare two envelopes against a configured tolerance and return
 * the per-row diffs that exceed it. The returned array is empty when
 * every row in `next` conforms.
 *
 * Both envelopes are validated by `readBaseline` before they reach
 * this function, so the comparator does not re-validate.
 *
 * The comparator iterates over `next.rows` and, for each row, looks
 * up the matching row in `prev.rows` by the configured
 * `identifierKey` (default `path`). Rows present in `prev` but
 * absent in `next` are treated as deletions and emit no Diff —
 * removing a regression is never a regression. Rows present in
 * `next` but absent in `prev` are treated as new rows and are
 * compared against `0` (the implicit floor for higher-is-better
 * metrics and the implicit baseline for lower-is-better metrics).
 */
export function compareWithTolerance<R extends Row, U>(
  prev: BaselineEnvelope<R, U>,
  next: BaselineEnvelope<R, U>,
  tolerance: ToleranceSpec,
  config: CompareConfig,
): Diff<R>[] {
  const identifierKey = config.identifierKey ?? 'path';
  const prevByKey = indexRows(prev.rows, identifierKey);

  const diffs: Diff<R>[] = [];
  for (const nextRow of next.rows) {
    const id = readIdentifier(nextRow, identifierKey);
    if (!id) continue;
    const prevRow = prevByKey.get(id);
    for (const axis of config.axes) {
      const nextValue = readNumeric(nextRow, axis);
      const prevValue = prevRow ? readNumeric(prevRow, axis) : 0;
      const violation = evaluate(tolerance, prevValue, nextValue, config.polarity);
      if (violation) {
        diffs.push({
          identifier: id,
          axis,
          prev: prevValue,
          next: nextValue,
          tolerance,
          severity: violation,
          row: nextRow,
        });
      }
    }
  }
  return diffs;
}

function indexRows<R extends Row>(rows: readonly R[], key: string): Map<string, R> {
  const map = new Map<string, R>();
  for (const row of rows) {
    const id = readIdentifier(row, key);
    if (id) map.set(id, row);
  }
  return map;
}

function readIdentifier(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' ? v : null;
}

function readNumeric(row: Row, key: string): number {
  const v = row[key];
  return typeof v === 'number' ? v : 0;
}

/**
 * Evaluate a single (prev, next) pair against a tolerance spec.
 * Returns `'fail'` or `'warn'` when the pair violates the spec, or
 * `null` when it conforms.
 *
 * Exported for direct use by dimension scripts that need to apply
 * tolerance to a rollup axis (the rollup is `prev.rollup['*'][axis]`
 * vs `next.rollup['*'][axis]`); the row-iterating wrapper above is
 * the typical path.
 *
 * The dispatch is intentionally thin — each `ToleranceSpec.kind` is
 * handled by a single-responsibility helper below. Keeping the
 * branch density per helper low keeps the CRAP score per method
 * manageable even when per-method coverage is treated as zero (the
 * default for the CRAP gate today).
 */
export function evaluate(
  tolerance: ToleranceSpec,
  prev: number,
  next: number,
  polarity: CompareConfig['polarity'],
): Severity | null {
  switch (tolerance.kind) {
    case 'absolute-pp':
      return evaluateAbsolutePp(tolerance, prev, next, polarity ?? 'higher-is-better');
    case 'relative-pct':
      return evaluateRelativePct(tolerance, prev, next, polarity ?? 'higher-is-better');
    case 'absolute-int':
      return evaluateAbsoluteInt(tolerance, prev, next, polarity ?? 'lower-is-better');
    case 'hard-cap':
      return evaluateHardCap(tolerance, next);
    case 'route-band':
      return evaluateRouteBand(tolerance, prev, next);
  }
}

// `absolute-pp` — coverage-shaped. For higher-is-better axes a drop
// of more than `pp` below `prev` fails; for lower-is-better axes the
// symmetric rise fails. Polarity defaults higher-is-better (coverage)
// at the dispatcher.
function evaluateAbsolutePp(
  spec: Extract<ToleranceSpec, { kind: 'absolute-pp' }>,
  prev: number,
  next: number,
  polarity: Polarity,
): Severity | null {
  if (polarity === 'higher-is-better') {
    return next < prev - spec.pp ? 'fail' : null;
  }
  return next > prev + spec.pp ? 'fail' : null;
}

// `relative-pct` — mutation/CRAP-shaped. The percent is taken against
// |prev|; a `prev === 0` row is a free pass for higher-is-better
// (any gain is welcome) and fails on any positive next for
// lower-is-better (the implicit floor catches new regressions).
function evaluateRelativePct(
  spec: Extract<ToleranceSpec, { kind: 'relative-pct' }>,
  prev: number,
  next: number,
  polarity: Polarity,
): Severity | null {
  if (prev === 0) {
    return evaluateRelativePctZeroPrev(next, polarity);
  }
  const allowed = (spec.pct / 100) * Math.abs(prev);
  if (polarity === 'higher-is-better') {
    return next < prev - allowed ? 'fail' : null;
  }
  return next > prev + allowed ? 'fail' : null;
}

function evaluateRelativePctZeroPrev(next: number, polarity: Polarity): Severity | null {
  if (polarity === 'higher-is-better') return null;
  return next > 0 ? 'fail' : null;
}

// `absolute-int` — lint-warning-shaped. Integer-delta tolerance with
// polarity defaulting lower-is-better (rising warning counts are
// bad) at the dispatcher.
function evaluateAbsoluteInt(
  spec: Extract<ToleranceSpec, { kind: 'absolute-int' }>,
  prev: number,
  next: number,
  polarity: Polarity,
): Severity | null {
  if (polarity === 'higher-is-better') {
    return next < prev - spec.delta ? 'fail' : null;
  }
  return next > prev + spec.delta ? 'fail' : null;
}

// `hard-cap` — bundle-size-shaped. Polarity-free: the cap is the
// cap. Two thresholds — below `warnPct * cap` is conforming, between
// the warn band and the cap is `warn`, at or above the cap is `fail`.
function evaluateHardCap(
  spec: Extract<ToleranceSpec, { kind: 'hard-cap' }>,
  next: number,
): Severity | null {
  if (next >= spec.cap) return 'fail';
  if (next >= spec.warnPct * spec.cap) return 'warn';
  return null;
}

// `route-band` — lighthouse-shaped. Two-sided ±plusMinus check;
// either direction past the band is a fail.
function evaluateRouteBand(
  spec: Extract<ToleranceSpec, { kind: 'route-band' }>,
  prev: number,
  next: number,
): Severity | null {
  return Math.abs(next - prev) > spec.plusMinus ? 'fail' : null;
}
