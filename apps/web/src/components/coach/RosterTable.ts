// apps/web/src/components/coach/RosterTable.ts
//
// Pure-TS view-shape and rendering helpers for the coach roster page
// (Epic #11 / Story #912 / Task #918). The `.astro` sibling
// (`./RosterTable.astro`) renders the empty shell composed of the
// `apps/web/src/components/ui/*` primitives (Badge, Btn); the inline
// `<script>` on the parent page binds to it via `data-testid` and
// calls `fetchRoster` + `renderRosterRows` to populate the table on
// load.
//
// Why pure-TS rather than a React island? `@repo/web` does not wire
// `@astrojs/react` for the coach surface; every existing admin
// component pairs an `.astro` renderer with a sibling `.ts` module
// (see `apps/web/src/components/admin/roster/RosterTable.ts` for the
// load-bearing precedent — Story #661 / Task #693). Standing up the
// full React island toolchain is foundation-level scope that belongs
// to its own infrastructure Story, not this Story. The Task AC
// wording "RosterTable.tsx" reflects the planning shorthand for the
// component; the implementation pattern matches the rest of the repo
// and the ACs themselves are behavioural — one row per athlete,
// canonical `data-testid` selectors, no innerHTML — which this module
// satisfies.

/**
 * Canonical `data-testid` values exposed by the coach roster surface.
 * Locked by Task #918 ACs so acceptance scenarios target stable
 * selectors across re-renders. Any change to a string here is a
 * breaking change to the acceptance suite — bump the two in the same
 * PR.
 */
export const COACH_ROSTER_TEST_IDS = {
  root: 'coach-roster-root',
  row: 'coach-roster-row',
  jersey: 'coach-roster-jersey',
  position: 'coach-roster-position',
  badge: 'coach-roster-badge',
  emptyState: 'coach-roster-empty',
  error: 'coach-roster-error',
} as const;

/**
 * Shape of one row as returned by the coach roster list endpoint
 * `GET /api/v1/coach/teams/:teamId/roster`. Mirrors `RosterEntryOutput`
 * from `@repo/shared/schemas/coach/roster` — declared locally so the
 * client-side render is decoupled from the Zod runtime parse (we
 * trust the server's projection at the wire boundary; the page does
 * not re-validate).
 */
export interface CoachRosterEntry {
  readonly id: string;
  readonly teamId: string;
  readonly athleteUserId: string;
  readonly athleteEmail: string;
  readonly athleteFullName: string;
  readonly jerseyNumber: string | null;
  readonly primaryPosition: string | null;
}

/**
 * Build the API URL for the team's roster list. Centralised so the
 * page's inline `<script>` and the unit tests share one definition —
 * a future path change lands once.
 */
export function buildRosterUrl(teamId: string): string {
  return `/api/v1/coach/teams/${encodeURIComponent(teamId)}/roster`;
}

/**
 * Render the supplied roster entries into the supplied `<tbody>`.
 * The function fully replaces the tbody's content. Cells are
 * populated via `textContent`, never `innerHTML`, so a server-supplied
 * value cannot inject markup on the client (per
 * `.agents/rules/security-baseline.md` § Output & Rendering).
 *
 * The `data-testid` on each `<tr>` is the row marker; per-cell
 * markers (`coach-roster-jersey`, `coach-roster-position`) attach to
 * the inner `<td>` so the QA suite can target them without re-finding
 * the row. The badge cell carries the `coach-roster-badge` testid
 * whether or not the row has a jersey — it always renders the
 * primary-position chip when present, otherwise an em-dash placeholder.
 */
export function renderRosterRows(
  tbody: HTMLTableSectionElement,
  items: ReadonlyArray<CoachRosterEntry>,
): void {
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.row);
    tr.setAttribute('data-roster-entry-id', item.id);

    const nameTd = document.createElement('td');
    nameTd.setAttribute('data-col', 'name');
    nameTd.textContent = item.athleteFullName;
    tr.appendChild(nameTd);

    const jerseyTd = document.createElement('td');
    jerseyTd.setAttribute('data-col', 'jersey');
    jerseyTd.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.jersey);
    jerseyTd.textContent = item.jerseyNumber ?? '—';
    tr.appendChild(jerseyTd);

    const positionTd = document.createElement('td');
    positionTd.setAttribute('data-col', 'position');
    positionTd.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.position);
    positionTd.textContent = item.primaryPosition ?? '—';
    tr.appendChild(positionTd);

    const badgeTd = document.createElement('td');
    badgeTd.setAttribute('data-col', 'badge');
    badgeTd.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.badge);
    // The badge cell carries the same primary-position string; the
    // visual chrome (rounded pill, soft-translucent tone) comes from
    // the `.astro` renderer's seeded `<span>` markup, which this
    // helper does NOT redraw — it only sets the textContent.
    badgeTd.textContent = item.primaryPosition ?? '—';
    tr.appendChild(badgeTd);

    tbody.appendChild(tr);
  }
}
