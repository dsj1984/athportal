// apps/web/src/components/ui/Select.tsx
//
// React-island Select primitive. Shares the cva matrix with Input and
// Textarea so the intent (default | invalid) styling cannot drift.
// Forwards refs and every native <select> attribute; children render
// the <option> set the consumer supplies.
//
// Story #715 / Task #727 — Epic #702 design-system foundation.

import * as React from 'react';
import { cn } from './_lib/cn';
import { type FormIntent, formControlVariants } from './_lib/form';

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  /** Visual + ARIA intent. Defaults to `default`. */
  intent?: FormIntent;
  /** Optional extra class names merged via `cn`. */
  className?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ intent = 'default', className, children, ...rest }, ref) => {
    return (
      <select
        ref={ref}
        aria-invalid={intent === 'invalid' ? true : undefined}
        className={cn(formControlVariants({ intent }), className)}
        {...rest}
      >
        {children}
      </select>
    );
  },
);

Select.displayName = 'Select';
