// apps/web/src/components/ui/EventChip.ts
//
// Pure-TS view-shape builder for the EventChip composite primitive.
// The `.astro` sibling renders the markup; this file is the testable
// surface — the web Vitest project runs in a `node` environment with
// no Astro renderer, so the chip's logic (colour resolution, conflict
// dot gating, inline-style composition for the inset stripe) lives
// here.
//
// Story #712 / Task #726. Tech Spec #704. Style guide §4.6.

import {
  CONFLICT_DOT_COLOR,
  type EventColorTriple,
  type EventType,
  resolveEventColor,
} from './_lib/eventColors';

/** Canonical data-testid exposed by EventChip's root element. */
export const EVENT_CHIP_TEST_ID = 'event-chip';
/** Canonical data-testid exposed by the conflict-indicator dot when present. */
export const EVENT_CHIP_CONFLICT_DOT_TEST_ID = 'event-chip-conflict-dot';

/** Public props for the EventChip primitive. */
export interface EventChipProps {
  /** The event's canonical type — drives the colour map. */
  readonly type: EventType;
  /** Sentence-case event title, e.g. "Varsity vs. Glenwood". */
  readonly title: string;
  /**
   * Optional pre-formatted time string ("4:00 PM"). Formatting is the
   * caller's responsibility — the chip never imports a locale layer.
   */
  readonly time?: string;
  /** Optional team display name to disambiguate multi-team rosters. */
  readonly team?: string;
  /**
   * When true, the chip renders a 6px action-coral dot in the
   * top-right corner per docs/style-guide.md §4.6 (Conflict
   * indicators). Defaults to false.
   */
  readonly conflict?: boolean;
  /** Optional data-testid override (defaults to the canonical id). */
  readonly testId?: string;
}

/** Render-time view shape consumed by the `.astro` sibling. */
export interface EventChipView {
  readonly type: EventType;
  readonly title: string;
  readonly time: string | null;
  readonly team: string | null;
  readonly conflict: boolean;
  readonly colors: EventColorTriple;
  /**
   * Pre-composed style string for the root chip element. Carries the
   * background fill, border colour, text colour, and the inset 3px
   * stripe (box-shadow inset 3px 0 0 <typeColor>) all in one place so
   * the `.astro` template stays a thin renderer.
   */
  readonly rootStyle: string;
  /** Pre-composed style for the conflict-dot indicator, or null. */
  readonly conflictDotStyle: string | null;
  readonly testIds: {
    readonly root: string;
    readonly conflictDot: string;
  };
}

/**
 * Project an EventChip's props into the render-ready view. Resolves
 * the type → colour triple through `resolveEventColor` (which throws
 * on unmapped types), trims optional strings defensively, and
 * pre-composes the inline-style strings the `.astro` sibling writes
 * directly onto the chip element.
 */
export function buildEventChipView(props: EventChipProps): EventChipView {
  const title = props.title.trim();
  if (title.length === 0) {
    throw new TypeError('EventChip: `title` must be a non-empty string.');
  }

  const colors = resolveEventColor(props.type);
  const time = normaliseOptional(props.time);
  const team = normaliseOptional(props.team);
  const conflict = props.conflict === true;
  const rootTestId = props.testId?.trim() || EVENT_CHIP_TEST_ID;

  // The inset 3px stripe is keyed to the type's text colour and lives
  // on the chip's leading edge. We compose the entire style string
  // here so the .astro sibling never duplicates the format.
  const rootStyle = [
    `background-color:${colors.bg}`,
    `color:${colors.text}`,
    `border:1px solid ${colors.border}`,
    `box-shadow:inset 3px 0 0 ${colors.text}`,
  ].join(';');

  const conflictDotStyle = conflict
    ? [
        `background-color:${CONFLICT_DOT_COLOR}`,
        'width:6px',
        'height:6px',
        'border-radius:9999px',
        'position:absolute',
        'top:4px',
        'right:4px',
      ].join(';')
    : null;

  return {
    type: props.type,
    title,
    time,
    team,
    conflict,
    colors,
    rootStyle,
    conflictDotStyle,
    testIds: {
      root: rootTestId,
      conflictDot: EVENT_CHIP_CONFLICT_DOT_TEST_ID,
    },
  };
}

function normaliseOptional(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
