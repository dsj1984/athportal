// apps/web/src/components/ui/_lib/form.ts
//
// Canonical form-control variant matrix. A single cva object is the
// source of truth for Input, Textarea, and Select so the intent
// (default | invalid) styling cannot drift between primitives. The
// invalid intent layers the action-coral border + ring per
// docs/style-guide.md §3.2 (Alert Coral = destructive / errors).
//
// Story #715 / Task #727 — Epic #702 design-system foundation.

import { type VariantProps, cva } from 'class-variance-authority';

/** Valid intent variants for any form control. */
export type FormIntent = 'default' | 'invalid';

/**
 * Shared cva matrix for Input, Textarea, and Select primitives. The
 * base classes anchor the focus ring to `--color-brand`; intent
 * variants override the border (and, for `invalid`, the focus-ring
 * color) so an invalid control reads as destructive at every
 * interaction stage.
 */
export const formControlVariants = cva(
  [
    'block',
    'w-full',
    'rounded-md',
    'bg-surface-card',
    'text-text-primary',
    'border',
    'px-3',
    'py-2',
    'text-sm',
    'transition-colors',
    'placeholder:text-text-secondary',
    'focus-visible:outline-none',
    'focus-visible:ring-2',
    'focus-visible:ring-offset-2',
    'focus-visible:ring-brand/40',
    'disabled:cursor-not-allowed',
    'disabled:opacity-50',
  ].join(' '),
  {
    variants: {
      intent: {
        default: 'border-border',
        invalid: 'border-action-coral focus-visible:ring-action-coral/40',
      } satisfies Record<FormIntent, string>,
    },
    defaultVariants: {
      intent: 'default',
    },
  },
);

export type FormControlVariantProps = VariantProps<typeof formControlVariants>;
