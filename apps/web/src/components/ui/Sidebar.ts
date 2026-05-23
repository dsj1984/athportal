// apps/web/src/components/ui/Sidebar.ts
//
// Pure-TS view-shape builder for the Sidebar composite primitive. The
// `.astro` sibling renders the markup with lucide-react glyphs; this
// builder resolves the persona → nav-set and computes per-item active
// styling so the unit tier can exercise the logic without a renderer.
//
// Story #712 / Task #729.

import {
  type SidebarNavItem,
  type SidebarPersona,
  resolveSidebarNav,
} from './_lib/sidebarNav';

export const SIDEBAR_TEST_ID = 'sidebar';
export const SIDEBAR_ITEM_TEST_ID_PREFIX = 'sidebar-item-';

/** Public props for the Sidebar composite primitive. */
export interface SidebarProps {
  /** Which persona's nav list to render. */
  readonly persona: SidebarPersona;
  /**
   * Optional href of the currently-active route. When supplied, the
   * matching nav row receives the active-styling treatment (the
   * color-mix(brand 10%) background from the Epic #702 handoff).
   */
  readonly active?: string;
  /** Optional data-testid override for the sidebar root. */
  readonly testId?: string;
}

/** Per-row view shape consumed by the `.astro` renderer. */
export interface SidebarRowView extends SidebarNavItem {
  readonly active: boolean;
  /** Pre-composed inline style for the active background, or null. */
  readonly activeStyle: string | null;
  readonly testId: string;
}

/** Top-level view shape for the Sidebar. */
export interface SidebarView {
  readonly persona: SidebarPersona;
  readonly rows: readonly SidebarRowView[];
  readonly testId: string;
}

/**
 * The active-row background. Anchored to the Epic #702 handoff
 * decision: active sidebar rows render at color-mix(in srgb, brand
 * 10%, transparent) so the chrome stays light while the active row
 * still reads as the current location. Surfaced as a single token so
 * the value never duplicates between view-builder and renderer.
 */
export const SIDEBAR_ACTIVE_BG =
  'color-mix(in srgb, var(--color-brand) 10%, transparent)';

/**
 * Project a Sidebar's props into the render-ready view. Resolves the
 * persona's nav list through the registry (which throws on unknown
 * personas) and flags the row whose `href` matches `active`.
 */
export function buildSidebarView(props: SidebarProps): SidebarView {
  const items = resolveSidebarNav(props.persona);
  const activeHref = props.active?.trim() ?? '';
  const rows: SidebarRowView[] = items.map((item) => {
    const active = activeHref.length > 0 && item.href === activeHref;
    return {
      ...item,
      active,
      activeStyle: active ? `background-color:${SIDEBAR_ACTIVE_BG}` : null,
      testId: `${SIDEBAR_ITEM_TEST_ID_PREFIX}${slug(item.label)}`,
    };
  });
  return {
    persona: props.persona,
    rows,
    testId: props.testId?.trim() || SIDEBAR_TEST_ID,
  };
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
