// apps/web/src/components/ui/Card.ts
//
// Pure-TS class-builder for the Card primitive — a bordered surface
// keyed to the global.css design tokens (--color-surface-card,
// --color-border, --radius-lg). Accepts a `soft` boolean to switch on
// the small drop shadow (--shadow-sm) per docs/style-guide.md §4.3.
//
// Story #713 / Task #725 — Epic #702 design system primitive library.

import { cn } from './_lib/cn';

export interface CardProps {
  /** When true, layers the shadow-sm token over the bordered surface. */
  readonly soft?: boolean;
  /** Optional extra classes, merged through `cn`. */
  readonly class?: string;
}

export interface CardView {
  readonly soft: boolean;
  /** Class string for the card root. */
  readonly rootClass: string;
}

export function buildCardView(props: CardProps = {}): CardView {
  const soft = props.soft === true;
  const rootClass = cn(
    'rounded-xl border border-border bg-surface-card p-6',
    soft && 'shadow-sm',
    props.class,
  );
  return { soft, rootClass };
}
