// apps/web/src/components/ui/ToastHost.tsx
//
// React-island wrapper around Sonner's <Toaster /> that the root Astro
// layout mounts exactly once (Task #731). Pinning the configuration here
// — `richColors`, `closeButton`, `position="bottom-right"` — keeps every
// page on the same toast surface without each layout / island
// re-negotiating the props. Consumers fire toasts through the canonical
// helper at `./_lib/toast`, never by importing Sonner directly.
//
// Story #714 / Task #730 — Epic #702 design-system foundation. Tech
// Spec #704 §Toast pins this component as the single Toaster mount.

import { Toaster } from 'sonner';

export function ToastHost(): React.JSX.Element {
  return <Toaster richColors closeButton position="bottom-right" />;
}
