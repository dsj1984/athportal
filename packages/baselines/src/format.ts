// packages/baselines/src/format.ts
//
// `formatRejectionMessage` — reviewer-facing multiline output for the
// `<dim>:check` scripts. Given a `BaselineKind` and the `Diff[]` from
// `compareWithTolerance`, returns a deterministic string suitable for
// piping to stderr.
//
// Format contract (one Diff group per call):
//
//   [@repo/baselines] <kind> baseline check failed: N violation(s)
//     <severity-glyph> <identifier> · <axis>: <prev> → <next>
//         tolerance: <kind>(<param>=<value>[, ...])
//
// The `severity-glyph` is `✖` for `fail` and `⚠` for `warn`. The
// glyph choice is ASCII-friendly so terminals without unicode still
// render legibly via the `severity` word in parentheses on the same
// line.

import type { BaselineKind, Diff, DiffSeverity, ToleranceSpec } from './types.js';

const SEVERITY_GLYPHS: Record<DiffSeverity, string> = {
  fail: 'x',
  warn: '!',
};

/**
 * Render a `Diff[]` for human consumption. The output is stable —
 * diffs are emitted in iteration order so a deterministic caller
 * yields deterministic output.
 *
 * Empty input returns an empty string so callers can compose without
 * branching on length.
 */
export function formatRejectionMessage<R>(kind: BaselineKind, diffs: readonly Diff<R>[]): string {
  if (diffs.length === 0) return '';
  const lines: string[] = [];
  const failCount = diffs.filter((d) => d.severity === 'fail').length;
  const warnCount = diffs.length - failCount;
  const summary =
    warnCount === 0
      ? `${diffs.length} violation${diffs.length === 1 ? '' : 's'}`
      : `${failCount} fail · ${warnCount} warn`;
  lines.push(`[@repo/baselines] ${kind} baseline check failed: ${summary}`);
  for (const d of diffs) {
    const glyph = SEVERITY_GLYPHS[d.severity];
    lines.push(
      `  ${glyph} (${d.severity}) ${d.identifier} · ${d.axis}: ${formatNumber(d.prev)} → ${formatNumber(d.next)}`,
    );
    lines.push(`      tolerance: ${formatTolerance(d.tolerance)}`);
  }
  return lines.join('\n');
}

function formatTolerance(t: ToleranceSpec): string {
  switch (t.kind) {
    case 'absolute-pp':
      return `absolute-pp(pp=${formatNumber(t.pp)})`;
    case 'relative-pct':
      return `relative-pct(pct=${formatNumber(t.pct)})`;
    case 'absolute-int':
      return `absolute-int(delta=${t.delta})`;
    case 'hard-cap':
      return `hard-cap(cap=${formatNumber(t.cap)}, warnPct=${formatNumber(t.warnPct)})`;
    case 'route-band':
      return `route-band(plusMinus=${formatNumber(t.plusMinus)})`;
  }
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // Trim trailing zeros from a fixed-precision rendering so the
  // output is `1.5` not `1.50000`, but keep integers integer-shaped.
  if (Number.isInteger(n)) return n.toString();
  return Number.parseFloat(n.toFixed(4)).toString();
}
