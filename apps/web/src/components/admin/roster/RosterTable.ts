// apps/web/src/components/admin/roster/RosterTable.ts
//
// Pure-TS view-shape and rendering helpers for the org-wide roster
// admin page (Epic #10 / Story #661 / Task #693). The `.astro`
// sibling (`apps/web/src/pages/admin/roster.astro`) renders the empty
// shell and binds an inline browser-side `<script>` that calls
// `fetchRosterPage` + `renderRosterRows` to populate the table on
// load and on every filter / pagination interaction.
//
// Why pure-TS rather than a React island? `@repo/web` does not wire
// `@astrojs/react`; every existing admin component pairs an `.astro`
// renderer with a sibling `.ts` module (see TeamForm.ts for the
// load-bearing precedent). Standing up the full React island toolchain
// is foundation-level scope that belongs to its own infrastructure
// Story, not Story #661. The Task ACs are all behavior — one row per
// athlete, filter refetches, cursor-driven next-page — and the
// `data-testid` invariants are easier to test against a deterministic
// DOM render than a React reconciler. The Task's
// "RosterTable.tsx island" wording reflects the planning shorthand;
// the implementation pattern matches the rest of the repo.

import type { RosterItem } from '@repo/shared/schemas/admin/roster';

/**
 * Canonical data-testid values exposed by the org-wide roster surface.
 * Locked by Task #693 ACs so acceptance scenarios (Task #691) can
 * target stable selectors across re-renders. ANY change to one of
 * these strings is a breaking change to the acceptance suite — bump
 * the suite in the same PR.
 */
export const ROSTER_TEST_IDS = {
  table: 'admin-roster-table',
  tbody: 'admin-roster-tbody',
  row: 'admin-roster-row',
  filterTeam: 'admin-roster-filter-team',
  filterSport: 'admin-roster-filter-sport',
  nextPage: 'admin-roster-next-page',
  emptyState: 'admin-roster-empty',
  error: 'admin-roster-error',
} as const;

/**
 * Inputs the inline `<script>` carries from the filter / cursor state.
 * `cursor` is opaque — built from the API's `nextCursor` field — and
 * is omitted on the first page.
 */
export interface RosterFetchInput {
  readonly teamId?: string;
  readonly sport?: string;
  readonly cursor?: string;
}

/**
 * Shape of one page returned by `GET /api/v1/admin/roster`. Mirrors
 * `RosterPageSchema.data` from `@repo/shared/schemas/admin/roster`
 * (the wire shape is `{ success, data: { items, nextCursor } }`).
 */
export interface RosterPagePayload {
  readonly items: ReadonlyArray<RosterItem>;
  readonly nextCursor: string | null;
}

/**
 * Build the query string for `GET /api/v1/admin/roster` given the
 * current filter / cursor state. Empty filters are omitted — the API
 * accepts only non-empty values and the Zod boundary would otherwise
 * reject an empty `teamId=` as INVALID_QUERY.
 */
export function buildRosterQuery(input: RosterFetchInput): string {
  const params = new URLSearchParams();
  if (input.teamId && input.teamId.length > 0) params.set('teamId', input.teamId);
  if (input.sport && input.sport.length > 0) params.set('sport', input.sport);
  if (input.cursor && input.cursor.length > 0) params.set('cursor', input.cursor);
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

/**
 * Render the current page of athletes into the supplied `<tbody>`.
 * The function fully replaces the tbody's content — append-vs-replace
 * decisions live in the inline script (it reuses this helper for both
 * the initial render and the per-page swap).
 *
 * Cells are populated via `textContent`, never `innerHTML`, so the
 * server-supplied projection cannot inject markup on the client.
 * (Per `.agents/rules/security-baseline.md` § Output & Rendering —
 * `innerHTML` MUST NOT receive user-provided data without sanitization.)
 */
export function renderRosterRows(
  tbody: HTMLTableSectionElement,
  items: ReadonlyArray<RosterItem>,
): void {
  // Clear without parsing HTML.
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-testid', ROSTER_TEST_IDS.row);
    tr.setAttribute('data-athlete-id', item.athleteId);
    const cells: ReadonlyArray<readonly [string, string]> = [
      ['name', item.fullName],
      ['team', item.teamName],
      ['sport', item.sport],
      ['age-group', item.ageGroup],
      ['verified-count', String(item.verifiedAchievementCount)],
    ];
    for (const [col, value] of cells) {
      const td = document.createElement('td');
      td.setAttribute('data-col', col);
      td.textContent = value;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}
