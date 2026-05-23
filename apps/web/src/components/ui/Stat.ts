// apps/web/src/components/ui/Stat.ts
//
// Pure-TS view-shape builder for the Stat primitive — a small
// label / value / unit triplet used on dashboard cards. Supports an
// optional trend indicator (up / down / flat), a verified flag (which
// surfaces the VerifiedTick atom next to the value), and an
// auxiliary hint line below the value.
//
// Story #713 / Task #725 — Epic #702 design system primitive library.

import { cn } from './_lib/cn';

/** Allowed trend tokens. */
export const STAT_TRENDS = ['up', 'down', 'flat'] as const;
export type StatTrend = (typeof STAT_TRENDS)[number];

export interface StatProps {
  /** Caption above the value (e.g. "Win rate", "Goals/game"). */
  readonly label: string;
  /** Headline number / string the card centres on. */
  readonly value: string | number;
  /** Optional unit suffix (e.g. "%", "min", "kg"). */
  readonly unit?: string;
  /** Optional trend direction, drives the trend-icon colour. */
  readonly trend?: StatTrend;
  /**
   * When true, renders the VerifiedTick atom adjacent to the value
   * (used on stats sourced from an authoritative system like Hudl).
   */
  readonly verified?: boolean;
  /** Optional secondary line below the value. */
  readonly hint?: string;
  /** Optional extra classes, merged through `cn`. */
  readonly class?: string;
}

export interface StatView {
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
  readonly trend: StatTrend | null;
  readonly showVerified: boolean;
  readonly hint: string | null;
  readonly rootClass: string;
  readonly valueClass: string;
  readonly labelClass: string;
  readonly trendClass: string;
}

export function buildStatView(props: StatProps): StatView {
  const label = props.label.trim();
  if (label.length === 0) {
    throw new TypeError('Stat: `label` must be a non-empty string.');
  }
  const value = String(props.value).trim();
  if (value.length === 0) {
    throw new TypeError('Stat: `value` must be a non-empty string or number.');
  }
  const unit = props.unit?.trim() || null;
  const hint = props.hint?.trim() || null;
  const trend = resolveTrend(props.trend);
  const showVerified = props.verified === true;
  const rootClass = cn('flex flex-col gap-1', props.class);
  // The value uses the display font so the number reads as a
  // headline, per docs/style-guide.md §2.
  const valueClass = cn('font-display text-2xl font-semibold text-text-primary');
  const labelClass = cn('text-xs font-medium text-text-secondary');
  const trendClass = trend ? cn('text-xs font-semibold', trendColour(trend)) : '';
  return {
    label,
    value,
    unit,
    trend,
    showVerified,
    hint,
    rootClass,
    valueClass,
    labelClass,
    trendClass,
  };
}

function resolveTrend(trend: StatTrend | undefined): StatTrend | null {
  if (trend && (STAT_TRENDS as readonly string[]).includes(trend)) {
    return trend;
  }
  return null;
}

function trendColour(trend: StatTrend): string {
  switch (trend) {
    case 'up':
      return 'text-action-lime';
    case 'down':
      return 'text-action-coral';
    case 'flat':
      return 'text-text-secondary';
  }
}
