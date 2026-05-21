// apps/web/src/components/ui/EmptyState.ts
//
// Pure builder for the shared EmptyState primitive. The `.astro` sibling
// (`EmptyState.astro`) renders the HTML using these helpers; consumers
// import the `.astro` component in pages and the `.ts` helpers in tests.
//
// Why split? The web workspace's Vitest project runs in a `node`
// environment with no JSX/Astro renderer wired in. Keeping the
// copy/CTA shaping pure-TS lets the unit tier exercise the primitive's
// behavior (title/body presence, CTA gating, data-testid invariance)
// without standing up a renderer.

/**
 * Optional call-to-action attached to an empty state. Empty states
 * should expose a single primary action that resolves the zero-data
 * surface (see docs/style-guide.md §4.5).
 */
export interface EmptyStateAction {
  /** Sentence-case label, e.g. "Join a team". */
  readonly label: string;
  /** Destination href. Validated as a non-empty string by the builder. */
  readonly href: string;
}

/** Public props for the EmptyState primitive. */
export interface EmptyStateProps {
  /** Sentence-case title describing the absence ("No teams yet"). */
  readonly title: string;
  /** One-sentence explanation + next-step hint. */
  readonly body: string;
  /** Optional CTA. When omitted, no CTA renders. */
  readonly action?: EmptyStateAction;
  /**
   * Optional override for the root data-testid. Defaults to
   * `empty-state`; downstream callers (e.g. dashboard widgets) may
   * scope this to disambiguate multiple empty states on one page.
   */
  readonly testId?: string;
}

/** Canonical data-testid values exposed by the primitive. */
export const EMPTY_STATE_TEST_IDS = {
  root: 'empty-state',
  cta: 'empty-state-cta',
} as const;

/**
 * Shape produced by the builder. Mirrors the HTML the `.astro`
 * component emits so the unit tier asserts against the same surface
 * shape the page renders.
 */
export interface EmptyStateView {
  readonly title: string;
  readonly body: string;
  readonly action: EmptyStateAction | null;
  readonly testIds: {
    readonly root: string;
    readonly cta: string;
  };
}

/**
 * Shape an EmptyState's props into the render-ready view. Trims copy
 * defensively and validates that the title and body are non-empty.
 * Throws a `TypeError` on invalid input so authoring mistakes fail
 * loudly at the call site rather than rendering a blank state.
 */
export function buildEmptyState(props: EmptyStateProps): EmptyStateView {
  const title = props.title.trim();
  const body = props.body.trim();
  if (title.length === 0) {
    throw new TypeError('EmptyState: `title` must be a non-empty string.');
  }
  if (body.length === 0) {
    throw new TypeError('EmptyState: `body` must be a non-empty string.');
  }

  const action = normalizeAction(props.action);

  const rootTestId = props.testId?.trim() || EMPTY_STATE_TEST_IDS.root;

  return {
    title,
    body,
    action,
    testIds: {
      root: rootTestId,
      cta: EMPTY_STATE_TEST_IDS.cta,
    },
  };
}

function normalizeAction(action: EmptyStateAction | undefined): EmptyStateAction | null {
  if (!action) return null;
  const label = action.label.trim();
  const href = action.href.trim();
  if (label.length === 0) {
    throw new TypeError(
      'EmptyState: CTA `label` must be a non-empty string when `action` is provided.',
    );
  }
  if (href.length === 0) {
    throw new TypeError(
      'EmptyState: CTA `href` must be a non-empty string when `action` is provided.',
    );
  }
  return { label, href };
}
