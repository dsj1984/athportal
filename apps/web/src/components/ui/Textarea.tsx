// apps/web/src/components/ui/Textarea.tsx
//
// React-island Textarea primitive. Shares the cva matrix with Input
// and Select so the intent (default | invalid) styling cannot drift.
// Forwards refs and every native <textarea> attribute.
//
// Story #715 / Task #727 — Epic #702 design-system foundation.

import * as React from 'react';
import { cn } from './_lib/cn';
import { type FormIntent, formControlVariants } from './_lib/form';

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  /** Visual + ARIA intent. Defaults to `default`. */
  intent?: FormIntent;
  /** Optional extra class names merged via `cn`. */
  className?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ intent = 'default', className, ...rest }, ref) => {
    return (
      <textarea
        ref={ref}
        aria-invalid={intent === 'invalid' ? true : undefined}
        className={cn(formControlVariants({ intent }), className)}
        {...rest}
      />
    );
  },
);

Textarea.displayName = 'Textarea';
