// apps/web/src/components/ui/_lib/eventColors.ts
//
// Canonical event_type → colour token map for the EventChip composite
// primitive. Anchored to docs/style-guide.md §4.6 ("Calendar & event
// chip styling") with the Epic #702 design-system handoff additions:
//
//   - `tournament` joins the canonical set (was previously absent from
//     §4.6 — handoff brings calendar parity for tournament events).
//   - Chip fills, text, and border use the soft translucent pill
//     pattern: 20% opacity fill, 200-shade text, 40% opacity border.
//   - The inset 3px stripe consumed by EventChip uses the same
//     per-type colour as `text`, surfaced via box-shadow inset.
//
// Story #712 / Task #726. Tech Spec #704.

/**
 * Canonical event types accepted by the EventChip composite primitive.
 * The set is fixed at authoring time — adding a new type requires both
 * extending this union *and* registering the colour triple below so
 * the chip cannot render with an unmapped type.
 */
export type EventType =
  | 'game'
  | 'practice'
  | 'training'
  | 'academic'
  | 'tournament'
  | 'meeting'
  | 'other';

/**
 * Per-type colour triple consumed by the EventChip surface. The three
 * fields map onto the soft-pill pattern from docs/style-guide.md §4.6:
 *
 *   - `bg`     — 20% opacity fill (chip background).
 *   - `text`   — 200-shade text colour; also drives the inset 3px
 *                stripe at the chip's leading edge.
 *   - `border` — 40% opacity border.
 */
export interface EventColorTriple {
  readonly bg: string;
  readonly text: string;
  readonly border: string;
}

/**
 * The canonical event_type → colour-triple map. Exported as a readonly
 * record so downstream consumers (the EventChip view builder, future
 * calendar surfaces, screenshot fixtures) read from a single source of
 * truth rather than re-deriving the palette per-call site.
 */
export const EVENT_COLORS: Readonly<Record<EventType, EventColorTriple>> = {
  // Game — rose
  game: {
    bg: 'rgb(244 63 94 / 0.2)',
    text: '#fda4af',
    border: 'rgb(244 63 94 / 0.4)',
  },
  // Practice — sky
  practice: {
    bg: 'rgb(14 165 233 / 0.2)',
    text: '#bae6fd',
    border: 'rgb(14 165 233 / 0.4)',
  },
  // Training — emerald
  training: {
    bg: 'rgb(16 185 129 / 0.2)',
    text: '#a7f3d0',
    border: 'rgb(16 185 129 / 0.4)',
  },
  // Academic — amber
  academic: {
    bg: 'rgb(245 158 11 / 0.2)',
    text: '#fde68a',
    border: 'rgb(245 158 11 / 0.4)',
  },
  // Tournament — violet (Epic #702 handoff addition)
  tournament: {
    bg: 'rgb(139 92 246 / 0.2)',
    text: '#ddd6fe',
    border: 'rgb(139 92 246 / 0.4)',
  },
  // Meeting — slate
  meeting: {
    bg: 'rgb(100 116 139 / 0.2)',
    text: '#cbd5e1',
    border: 'rgb(100 116 139 / 0.4)',
  },
  // Other — zinc
  other: {
    bg: 'rgb(113 113 122 / 0.2)',
    text: '#d4d4d8',
    border: 'rgb(113 113 122 / 0.4)',
  },
};

/**
 * The action-coral token surfaced by the design-system foundation.
 * EventChip uses this for the 6px conflict-indicator dot per
 * docs/style-guide.md §4.6 (Conflict indicators). Pulled into this
 * module so the EventChip view builder reads every colour decision
 * from a single seam.
 */
export const CONFLICT_DOT_COLOR = 'var(--color-action-coral)';

/**
 * Resolve the colour triple for a given event_type. Throws `TypeError`
 * for unmapped values so an unmapped chip is a loud authoring error
 * rather than a silently misrendered one. The throw keeps EventChip's
 * call site safe even if a `type` prop slips past a typo upstream
 * (e.g. JSON deserialisation that widens the type to `string`).
 */
export function resolveEventColor(type: EventType): EventColorTriple {
  const triple = EVENT_COLORS[type];
  if (!triple) {
    throw new TypeError(
      `EventChip: unknown event_type "${type}". Expected one of: ${Object.keys(EVENT_COLORS).join(', ')}.`,
    );
  }
  return triple;
}
