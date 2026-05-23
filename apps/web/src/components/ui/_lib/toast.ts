// apps/web/src/components/ui/_lib/toast.ts
//
// Canonical toast helper for every consumer under apps/web/. Re-exports
// Sonner's `toast` function so call sites import from
// `@/components/ui/_lib/toast` rather than reaching into the third-party
// package directly. Tech Spec #704 §Toast pins this single seam so future
// migrations (swapping Sonner for another toast surface, or wrapping the
// API with telemetry) happen in one file.
//
// Story #714 / Task #730 — Epic #702 design-system foundation.

export { toast } from 'sonner';
