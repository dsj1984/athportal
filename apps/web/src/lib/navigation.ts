// apps/web/src/lib/navigation.ts
//
// Persona → primary navigation registry for the authenticated App Shell
// (Story #971). The `<AppLayout>` chrome consumes `resolveAppNav(role)`
// to render the header nav links; per-persona Stories extend the list
// by adding rows here rather than touching the layout.
//
// Distinct from `apps/web/src/components/ui/_lib/sidebarNav.ts`:
//
//   - `sidebarNav.ts` carries the *design-system reference* nav set
//     wired to the (sidebar-style) `Shell` composite primitive. It's
//     the shape Epic #702 / Story #712 codified for the live styleguide
//     preview.
//   - This module carries the *production* nav set adopted by the
//     `<AppLayout>` header. The two diverge intentionally — production
//     surfaces today are CRUD pages (`/admin/teams`, `/admin/org`,
//     `/admin/invitations`, `/admin/import`, `/admin/reports`,
//     `/admin/rollover`) whereas the
//     styleguide preview uses the post-MVP "Overview / Coaches /
//     Athletes / Events" shape that the dashboard Epic will deliver.
//
// Story #971 ships only the `org_admin` nav list (the reference
// adoption is `/admin/teams`). Follow-up Stories add `coach` and
// `athlete` entries. Story #1086 added the `/admin/org` (Org config)
// row so an org-admin can reach every `/admin/*` surface from the
// shared header, and adopted `<AppLayout>` on the remaining admin
// pages (`/admin/org`, `/admin/reports`, `/admin/rollover`,
// `/admin/invitations`) that previously rendered a bare `<main>`.

/**
 * Roles consumed by the App Shell nav. Mirrors the values the API edge
 * accepts on `users.role` (see `requireRole('org_admin')` in the API
 * auth middleware). Keep these strings in lockstep with the API's
 * canonical role enum — when a new role is introduced server-side, add
 * it here too and the corresponding nav list will surface immediately.
 */
export type AppNavRole = 'org_admin' | 'coach' | 'athlete';

/**
 * A single primary-nav row rendered in the App Shell header. Plain
 * `label` + `href`; no icons (the header is a horizontal text-link
 * row, not the styleguide sidebar). Add an `icon` property here only
 * when a future Story introduces a visual treatment that needs one.
 */
export interface AppNavItem {
  /** Sentence-case label rendered in the header. */
  readonly label: string;
  /** Destination href, e.g. `/admin/teams`. */
  readonly href: string;
}

/**
 * The canonical role → primary-nav map. Frozen so accidental in-place
 * mutation by a consumer cannot drift the registry. Item ordering is
 * significant — it is the order `<AppLayout>` renders.
 *
 * Story #971 lands only the `org_admin` set. Empty arrays for the
 * other roles are deliberate placeholders: the resolver throws on an
 * unknown role today, and follow-up Stories swap each empty list for
 * the persona's real nav set.
 */
export const APP_NAV: Readonly<Record<AppNavRole, readonly AppNavItem[]>> = {
  org_admin: [
    { label: 'Teams', href: '/admin/teams' },
    { label: 'Org config', href: '/admin/org' },
    { label: 'Invitations', href: '/admin/invitations' },
    { label: 'Import', href: '/admin/import' },
    { label: 'Reports', href: '/admin/reports' },
    { label: 'Rollover', href: '/admin/rollover' },
  ],
  coach: [],
  athlete: [],
};

/**
 * Resolve the nav list for a role. Throws `TypeError` on an unknown
 * role so an upstream typo fails loudly at render time instead of
 * silently rendering an empty header.
 *
 * @param role - The signed-in user's `users.role` value.
 * @returns The ordered nav rows for that role.
 */
export function resolveAppNav(role: AppNavRole): readonly AppNavItem[] {
  const items = APP_NAV[role];
  if (!items) {
    throw new TypeError(
      `AppLayout: unknown role "${role}". Expected one of: ${Object.keys(APP_NAV).join(', ')}.`,
    );
  }
  return items;
}

/**
 * Per-row view shape consumed by the `<AppLayout>` renderer. Extends
 * `AppNavItem` with `active` (whether this row matches the page's
 * `activeHref`) and a stable `testId` derived from the row's label.
 */
export interface AppNavRowView extends AppNavItem {
  readonly active: boolean;
  readonly testId: string;
}

/**
 * data-testid prefix for each rendered nav row. The Story #971
 * reference adoption pins this so future test scenarios can target
 * `[data-testid="app-nav-item-teams"]` without re-deriving the slug.
 */
export const APP_NAV_ITEM_TEST_ID_PREFIX = 'app-nav-item-';

/** data-testid for the App Shell root <header>. */
export const APP_LAYOUT_HEADER_TEST_ID = 'app-layout-header';
/** data-testid for the App Shell <nav> element inside the header. */
export const APP_LAYOUT_NAV_TEST_ID = 'app-layout-nav';
/** data-testid for the App Shell <main> content slot. */
export const APP_LAYOUT_MAIN_TEST_ID = 'app-layout-main';
/** data-testid for the user-menu trigger button. */
export const APP_LAYOUT_USER_MENU_TEST_ID = 'app-layout-user-menu';
/** data-testid for the user-menu "Sign out" form submit button. */
export const APP_LAYOUT_SIGN_OUT_TEST_ID = 'app-layout-sign-out';

/**
 * Project the nav list for a role into the render-ready view. Marks
 * the row whose `href` matches `activeHref` as active and stamps each
 * row with a slug-derived `data-testid`.
 *
 * @param role - The role whose nav list to render.
 * @param activeHref - Optional href to flag as the active row. Pass
 *   `Astro.url.pathname` from the page frontmatter. When omitted or
 *   matching no row, every row renders inactive.
 * @returns The ordered view rows for the renderer.
 */
export function buildAppNavView(role: AppNavRole, activeHref?: string): readonly AppNavRowView[] {
  const items = resolveAppNav(role);
  const target = activeHref?.trim() ?? '';
  return items.map((item) => ({
    ...item,
    active: target.length > 0 && item.href === target,
    testId: `${APP_NAV_ITEM_TEST_ID_PREFIX}${slug(item.label)}`,
  }));
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
