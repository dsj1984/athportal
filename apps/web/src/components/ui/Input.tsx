// apps/web/src/components/ui/Input.tsx
//
// React-island Input primitive. Forwards refs so Astro pages and
// downstream forms can wire focus management; forwards every native
// <input> attribute. When `intent='invalid'` the rendered <input>
// carries `aria-invalid="true"` so assistive tech reports the error
// state, and the cva matrix swaps in the action-coral border + ring.
//
// Story #715 / Task #727 — Epic #702 design-system foundation.

import * as React from 'react';
import { cn } from './_lib/cn';
import { type FormIntent, formControlVariants } from './_lib/form';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** Visual + ARIA intent. Defaults to `default`. */
  intent?: FormIntent;
  /** Optional extra class names merged via `cn`. */
  className?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ intent = 'default', className, type = 'text', ...rest }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        aria-invalid={intent === 'invalid' ? true : undefined}
        className={cn(formControlVariants({ intent }), className)}
        {...rest}
      />
    );
  },
);

Input.displayName = 'Input';
