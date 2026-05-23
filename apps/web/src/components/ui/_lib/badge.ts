// apps/web/src/components/ui/_lib/badge.ts
//
// Pure-TS class-builder for the Badge primitive. Encodes the
// soft-translucent-pill rule from docs/style-guide.md §3.4:
//
//   background = bg-<color>/15  (12–15 % opacity accent)
//   foreground = text-<color>   (100 % opacity accent)
//
// Solid bg-<color>-900 chips are forbidden by the style guide and
// MUST NOT be emitted by this builder. The companion Badge.test.ts
// asserts the negative case so a regression cannot slip past unit
// tests.
//
// Story #713 / Task #724 — Epic #702 design system primitive library.

import { cn } from './cn';

/** Allowed tone tokens for the Badge primitive. */
export const BADGE_TONES = ['brand', 'cyan', 'lime', 'amber', 'coral', 'slate'] as const;

export type BadgeTone = (typeof BADGE_TONES)[number];

/**
 * Mapping of tone token → Tailwind utility pair (background, text).
 *
 * The project's accent tokens live under `--color-action-*`
 * (cyan / lime / amber / coral) and `--color-brand` in
 * apps/web/src/styles/global.css. `slate` is intentionally mapped to
 * the default Tailwind palette so neutral chips read as muted UI
 * chrome rather than as one of the four functional accents.
 */
const TONE_CLASSES: Readonly<Record<BadgeTone, { readonly bg: string; readonly text: string }>> = {
  brand: { bg: 'bg-brand/15', text: 'text-brand' },
  cyan: { bg: 'bg-action-cyan/15', text: 'text-action-cyan' },
  lime: { bg: 'bg-action-lime/15', text: 'text-action-lime' },
  amber: { bg: 'bg-action-amber/15', text: 'text-action-amber' },
  coral: { bg: 'bg-action-coral/15', text: 'text-action-coral' },
  slate: { bg: 'bg-slate-500/15', text: 'text-slate-700' },
};

/**
 * Mapping of tone token → dot indicator class. The dot is rendered
 * at full opacity to read as a status indicator (not a translucent
 * fill).
 */
const TONE_DOT_CLASSES: Readonly<Record<BadgeTone, string>> = {
  brand: 'bg-brand',
  cyan: 'bg-action-cyan',
  lime: 'bg-action-lime',
  amber: 'bg-action-amber',
  coral: 'bg-action-coral',
  slate: 'bg-slate-500',
};

/** Default tone applied when no `tone` prop is provided. */
export const DEFAULT_BADGE_TONE: BadgeTone = 'slate';

/** Public props for the Badge primitive. */
export interface BadgeProps {
  /** Tone token. Defaults to `slate` so unmarked chips render as muted. */
  readonly tone?: BadgeTone;
  /** When true, prepends a solid status dot in the matching tone. */
  readonly dot?: boolean;
  /** Optional extra classes, merged through `cn`. */
  readonly class?: string;
}

/** Render-time view shape consumed by the `.astro` sibling. */
export interface BadgeView {
  readonly tone: BadgeTone;
  readonly showDot: boolean;
  /** Class string for the chip root. */
  readonly rootClass: string;
  /** Class string for the dot element (only rendered when `showDot`). */
  readonly dotClass: string;
}

/**
 * Project Badge props into the rendered class strings. Always emits
 * the soft-translucent pair (bg-<tone>/15 + text-<tone>); never emits
 * a solid bg-<tone>-900 background.
 */
export function buildBadgeView(props: BadgeProps = {}): BadgeView {
  const tone = resolveTone(props.tone);
  const showDot = props.dot === true;
  const palette = TONE_CLASSES[tone];
  const rootClass = cn(
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
    palette.bg,
    palette.text,
    props.class,
  );
  const dotClass = cn('inline-block size-1.5 rounded-full', TONE_DOT_CLASSES[tone]);
  return { tone, showDot, rootClass, dotClass };
}

function resolveTone(tone: BadgeTone | undefined): BadgeTone {
  if (tone && (BADGE_TONES as readonly string[]).includes(tone)) {
    return tone;
  }
  return DEFAULT_BADGE_TONE;
}
