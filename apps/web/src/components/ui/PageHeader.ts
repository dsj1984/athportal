// apps/web/src/components/ui/PageHeader.ts
//
// Pure-TS class-builder for the PageHeader primitive — the canonical
// title + intro + actions page-chrome block (docs/style-guide.md §3
// palette/typography, §4 page chrome). The `.astro` sibling renders
// the markup; this builder shapes the copy and class strings so the
// unit tier can assert against the same surface shape the page
// renders without a JSX/Astro runtime.
//
// Story #836 / Task #845 — Epic #828 dashboard surface.

import { cn } from './_lib/cn';

/** Public props for the PageHeader primitive. */
export interface PageHeaderProps {
  /** Sentence-case page title rendered in the display typeface. */
  readonly title: string;
  /** Optional one-sentence intro/subtitle. */
  readonly intro?: string;
  /** Optional extra classes for the outer header, merged through `cn`. */
  readonly class?: string;
}

/** Canonical data-testid values exposed by the primitive. */
export const PAGE_HEADER_TEST_IDS = {
  root: 'page-header',
  title: 'page-header-title',
  intro: 'page-header-intro',
  actions: 'page-header-actions',
} as const;

/**
 * Render-time view of a PageHeader. Mirrors the markup `PageHeader.astro`
 * emits so the unit tier asserts against the same surface shape the page
 * renders.
 */
export interface PageHeaderView {
  readonly title: string;
  readonly intro: string | null;
  readonly hasActions: boolean;
  readonly rootClass: string;
  readonly titleClass: string;
  readonly introClass: string;
  readonly actionsClass: string;
  readonly testIds: {
    readonly root: string;
    readonly title: string;
    readonly intro: string;
    readonly actions: string;
  };
}

/**
 * Shape PageHeader's props into the render-ready view. Trims copy
 * defensively, validates that the title is non-empty, and surfaces
 * `hasActions` so the `.astro` sibling can decide whether to render
 * the right-aligned actions slot. `hasActions` is supplied at render
 * time by the caller (the slot's presence is detected with
 * `Astro.slots.has('actions')`); the builder accepts it as a flag so
 * the actions-branch can be exercised in unit tests without a renderer.
 *
 * Throws a `TypeError` on invalid input so authoring mistakes fail
 * loudly at the call site rather than rendering a blank header.
 */
export function buildPageHeader(
  props: PageHeaderProps,
  options: { hasActions?: boolean } = {},
): PageHeaderView {
  const title = props.title.trim();
  if (title.length === 0) {
    throw new TypeError('PageHeader: `title` must be a non-empty string.');
  }

  const introRaw = props.intro?.trim() ?? '';
  const intro = introRaw.length > 0 ? introRaw : null;
  const hasActions = options.hasActions === true;

  // Page chrome (§4): page-background spacing, display typography on the
  // title, body typography on the intro. The header stacks on mobile
  // and lays out title-left / actions-right on the `sm` breakpoint.
  const rootClass = cn(
    'flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between',
    props.class,
  );
  const titleClass = cn('font-display text-2xl font-semibold text-text-primary sm:text-3xl');
  const introClass = cn('mt-2 max-w-prose text-sm text-text-secondary sm:text-base');
  const actionsClass = cn(
    'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3',
  );

  return {
    title,
    intro,
    hasActions,
    rootClass,
    titleClass,
    introClass,
    actionsClass,
    testIds: { ...PAGE_HEADER_TEST_IDS },
  };
}
