// apps/web/src/components/ui/_lib/btn.ts
//
// Canonical Btn variant matrix. Sourced from Tech Spec #704 §Primitive
// library architecture, with kind/size combinations grounded in
// docs/style-guide.md §3.1 (brand palette) and §3.2 (functional accent
// colors). Every downstream UI Epic imports `btnVariants` rather than
// re-deriving class strings so kind/size additions land in one place.
//
// Story #715 / Task #722 — Epic #702 design-system foundation.

import { cva, type VariantProps } from 'class-variance-authority';

/**
 * The four canonical button kinds.
 *
 *   - primary : Hyper-Violet solid fill — the dominant call to action.
 *   - ghost   : Transparent fill with a tinted border, used as a
 *               secondary action next to a primary CTA.
 *   - subtle  : Transparent background, plain text — tertiary actions
 *               and inline affordances (e.g. "Cancel" in a form).
 *   - coral   : Alert-coral fill for destructive actions per
 *               docs/style-guide.md §3.2.
 */
export type BtnKind = 'primary' | 'ghost' | 'subtle' | 'coral';

/**
 * The three canonical button sizes.
 *
 *   - sm      : Compact button used in table rows, chips, and dense
 *               toolbars.
 *   - default : Standard form / dialog button.
 *   - lg      : Hero CTA / marketing surface.
 */
export type BtnSize = 'sm' | 'default' | 'lg';

/**
 * The full cva variant matrix. The base string anchors every Btn to the
 * focus-visible:ring keyed to `--color-brand` per docs/style-guide.md
 * §3.1; per-kind classes layer fill + hover; per-size classes set
 * padding and text size.
 */
export const btnVariants = cva(
  [
    'inline-flex',
    'items-center',
    'justify-center',
    'gap-2',
    'rounded-md',
    'font-medium',
    'transition-colors',
    'focus-visible:outline-none',
    'focus-visible:ring-2',
    'focus-visible:ring-brand/40',
    'focus-visible:ring-offset-2',
    'disabled:pointer-events-none',
    'disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      kind: {
        primary: 'bg-brand text-white hover:bg-brand-hover',
        ghost:
          'bg-transparent text-text-primary border border-border hover:bg-surface-hover',
        subtle: 'bg-transparent text-text-primary hover:bg-surface-hover',
        coral: 'bg-action-coral text-white hover:bg-action-coral/90',
      } satisfies Record<BtnKind, string>,
      size: {
        sm: 'h-8 px-3 text-sm',
        default: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      } satisfies Record<BtnSize, string>,
    },
    defaultVariants: {
      kind: 'primary',
      size: 'default',
    },
  },
);

export type BtnVariantProps = VariantProps<typeof btnVariants>;
