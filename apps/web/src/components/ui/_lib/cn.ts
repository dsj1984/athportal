// apps/web/src/components/ui/_lib/cn.ts
//
// Canonical class-merge helper for every primitive under
// apps/web/src/components/ui/. Combines clsx (conditional class composition)
// with tailwind-merge (last-write-wins conflict resolution for Tailwind
// utilities). Consumers MUST import cn from here rather than reaching into
// clsx or tailwind-merge directly — Tech Spec #704 §Primitive library
// architecture pins this single seam so future migrations (e.g. swapping
// tailwind-merge for a CSS-cascade-aware merger) happen in one file.

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
