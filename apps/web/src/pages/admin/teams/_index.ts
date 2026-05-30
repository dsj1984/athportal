// apps/web/src/pages/admin/teams/_index.ts
//
// Pure-TS view-builder for the `/admin/teams` list page (Story #657 /
// Task #676). The `.astro` sibling renders the markup; this module
// projects the API response into the shape the template iterates.
//
// Kept here as a sibling .ts so the same evaluator is unit-testable
// without spinning Astro.
//
// Prefixed with `_` so Astro does not register this module as a route.
// Astro's router ignores any file whose name starts with `_`, which
// prevents the boot-time "route defined in both .ts and .astro" warning
// that fires when a plain `.ts` sits alongside its `.astro` sibling in
// the pages directory (Story #1068).

export interface TeamListEntry {
  readonly id: string;
  readonly name: string;
  readonly sport: string;
  readonly season: string;
  readonly ageGroup: string;
  readonly archivedAt: string | null;
}

export interface TeamsListView {
  readonly heading: string;
  readonly showingArchived: boolean;
  readonly teams: ReadonlyArray<TeamListEntry>;
  readonly isEmpty: boolean;
}

export function buildTeamsListView(
  teams: ReadonlyArray<TeamListEntry>,
  showingArchived: boolean,
): TeamsListView {
  return {
    heading: showingArchived ? 'Archived teams' : 'Teams',
    showingArchived,
    teams,
    isEmpty: teams.length === 0,
  };
}
