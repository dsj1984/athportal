// apps/web/src/pages/_dashboard.ts
//
// Pure data-shaper for the post-onboarding dashboard. Encodes the
// initial widget set (RecentActivity, Roster, Upcoming) and the
// empty-state copy each widget falls back to when its data array is
// empty. The `dashboard.astro` sibling consumes `buildDashboard` and
// renders one `<EmptyState>` per widget; the unit tests assert that
// every widget surfaces an empty state on the zero-data branch (never
// a skeleton) and that the canonical data-testids stay stable.
//
// Prefixed with `_` so Astro does not register this module as a route.
// Astro's router ignores any file whose name starts with `_`, which
// prevents the boot-time "route defined in both .ts and .astro" warning
// that fires when a plain `.ts` sits alongside its `.astro` sibling in
// the pages directory (Story #1068).

import type { EmptyStateProps } from '../components/ui/EmptyState.ts';

/** Canonical widget identifiers (used as data-testids on the dashboard). */
export type DashboardWidgetId =
  | 'dashboard-widget-recent-activity'
  | 'dashboard-widget-roster'
  | 'dashboard-widget-upcoming';

/**
 * One team row rendered in the dashboard "Roster" widget (Story #985 /
 * F27). `href` is present for teams the user can navigate to (coach
 * teams link to the coach roster surface); it is omitted for athlete
 * memberships until the athlete team surface ships, so the row renders
 * as plain text rather than a dead link.
 */
export interface DashboardTeamRow {
  readonly teamId: string;
  readonly teamName: string;
  readonly role: 'coach' | 'athlete';
  readonly href?: string;
}

/** Per-widget data slices read by the dashboard. Each slice is an array; an empty array triggers the widget's empty state. */
export interface DashboardData {
  readonly recentActivity: readonly unknown[];
  readonly roster: readonly DashboardTeamRow[];
  readonly upcoming: readonly unknown[];
}

/** One widget's render-time view: either populated rows or an empty state. */
export interface DashboardWidgetView {
  readonly id: DashboardWidgetId;
  readonly heading: string;
  readonly isEmpty: boolean;
  readonly emptyState: EmptyStateProps;
  readonly rows: readonly unknown[];
}

/** Render-time view of the whole dashboard. */
export interface DashboardView {
  readonly widgets: readonly [DashboardWidgetView, DashboardWidgetView, DashboardWidgetView];
}

interface WidgetSpec {
  readonly id: DashboardWidgetId;
  readonly heading: string;
  readonly empty: EmptyStateProps;
}

/**
 * Static widget catalog. Empty-state copy follows
 * docs/style-guide.md §4.5 — sentence-case titles, one-sentence
 * descriptions, sentence-case CTA labels routing to the action that
 * resolves the empty state.
 */
const WIDGETS: readonly [WidgetSpec, WidgetSpec, WidgetSpec] = [
  {
    id: 'dashboard-widget-recent-activity',
    heading: 'Recent activity',
    empty: {
      title: 'Nothing in your feed yet',
      body: 'Activity from your teams will appear here as soon as your coaches or teammates post.',
      testId: 'dashboard-widget-recent-activity-empty',
    },
  },
  {
    id: 'dashboard-widget-roster',
    heading: 'Roster',
    empty: {
      title: 'No teams yet',
      body: 'Join or create a team to see your roster here.',
      action: { label: 'Join a team', href: '/teams/join' },
      testId: 'dashboard-widget-roster-empty',
    },
  },
  {
    id: 'dashboard-widget-upcoming',
    heading: 'Upcoming',
    empty: {
      title: 'Nothing scheduled yet',
      body: 'Upcoming practices, games, and events will land here once your team adds them.',
      testId: 'dashboard-widget-upcoming-empty',
    },
  },
];

/**
 * Project the dashboard data into the render-time view. Each widget's
 * `isEmpty` flag is `true` when its data slice is an empty array; the
 * `.astro` sibling reads that flag to choose between the empty state
 * and the data-populated branch.
 */
export function buildDashboard(data: DashboardData): DashboardView {
  const slices: Record<DashboardWidgetId, readonly unknown[]> = {
    'dashboard-widget-recent-activity': data.recentActivity,
    'dashboard-widget-roster': data.roster,
    'dashboard-widget-upcoming': data.upcoming,
  };

  const widgets = WIDGETS.map((spec) => {
    const rows = slices[spec.id];
    return {
      id: spec.id,
      heading: spec.heading,
      isEmpty: rows.length === 0,
      emptyState: spec.empty,
      rows,
    };
  }) as unknown as DashboardView['widgets'];

  return { widgets };
}

/**
 * Map the persisted "teams this user belongs to" rows into the
 * dashboard roster slice. Coach teams get an `href` to the coach
 * roster surface so the widget is a one-click path from `/dashboard`
 * to the roster (Story #985 / F27 / Probe 1). Athlete memberships
 * carry no `href` yet — the `/app/athlete/teams/...` surface does not
 * exist, and a dead link is worse than plain text — but still render
 * so the user sees every team they belong to.
 *
 * Pure function: exposed so `_dashboard.test.ts` can pin the href and
 * role mapping without an Astro context.
 */
export function buildRosterRows(
  teams: ReadonlyArray<{ teamId: string; teamName: string; role: 'coach' | 'athlete' }>,
): DashboardTeamRow[] {
  return teams.map((t) =>
    t.role === 'coach'
      ? {
          teamId: t.teamId,
          teamName: t.teamName,
          role: 'coach',
          href: `/app/coach/teams/${encodeURIComponent(t.teamId)}/roster`,
        }
      : { teamId: t.teamId, teamName: t.teamName, role: 'athlete' },
  );
}

/**
 * The data shape a freshly-onboarded user lands on — every slice
 * empty. Exposed so the page can render the no-data dashboard without
 * threading an empty literal at every call site, and so the tests can
 * assert the canonical default.
 */
export const EMPTY_DASHBOARD_DATA: DashboardData = {
  recentActivity: [],
  roster: [],
  upcoming: [],
};
