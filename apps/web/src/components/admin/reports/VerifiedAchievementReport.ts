// apps/web/src/components/admin/reports/VerifiedAchievementReport.ts
//
// Pure-TS view-shape and rendering helpers for the verified-achievement
// admin report (Epic #10 / Story #679 / Task #699). The `.astro`
// sibling (`apps/web/src/pages/admin/reports.astro`) renders the empty
// shells server-side and binds an inline browser-side `<script>` that
// calls `fetch('/api/v1/admin/reports/verified-achievements')` and
// renders the resulting rows into the two tables via
// `renderByTeamRows` / `renderBySportRows`.
//
// Why pure-TS rather than a React island? `@repo/web` does not wire
// `@astrojs/react`; every existing admin component pairs an `.astro`
// renderer with a sibling `.ts` module (see RosterTable.ts on the same
// epic for the load-bearing precedent). Standing up the full React
// island toolchain is foundation-level scope that belongs to its own
// infrastructure Story, not Story #679.
//
// Wire shape and aggregation behavior live in the contract test
// (`apps/api/src/routes/v1/admin/reports.contract.test.ts`). This
// module owns the published DOM contract — data-testid invariants
// `admin-report-by-team` and `admin-report-by-sport` — and the cell
// projection.

import type {
  VerifiedAchievementBySport,
  VerifiedAchievementByTeam,
} from '@repo/shared/schemas/admin/reports';

/**
 * Canonical data-testid values exposed by the verified-achievement
 * report surface. Locked by Task #699 ACs so the acceptance scenario
 * (Task #700) can target stable selectors across re-renders. ANY
 * change to one of these strings is a breaking change to the
 * acceptance suite — bump the suite in the same PR.
 */
export const REPORT_TEST_IDS = {
  byTeamTable: 'admin-report-by-team',
  byTeamTbody: 'admin-report-by-team-tbody',
  byTeamRow: 'admin-report-by-team-row',
  bySportTable: 'admin-report-by-sport',
  bySportTbody: 'admin-report-by-sport-tbody',
  bySportRow: 'admin-report-by-sport-row',
  emptyState: 'admin-report-empty',
  error: 'admin-report-error',
} as const;

/**
 * Shape of the report returned by
 * `GET /api/v1/admin/reports/verified-achievements`. Mirrors
 * `VerifiedAchievementReportSchema` from
 * `@repo/shared/schemas/admin/reports` (the wire shape is
 * `{ success, data: { byTeam, bySport } }`).
 */
export interface VerifiedAchievementReportPayload {
  readonly byTeam: ReadonlyArray<VerifiedAchievementByTeam>;
  readonly bySport: ReadonlyArray<VerifiedAchievementBySport>;
}

/**
 * Render the by-team aggregation into the supplied `<tbody>`. The
 * function fully replaces the tbody's content. Cells are populated via
 * `textContent`, never `innerHTML`, so the server-supplied projection
 * cannot inject markup on the client (per
 * `.agents/rules/security-baseline.md` § Output & Rendering —
 * `innerHTML` MUST NOT receive user-provided data without
 * sanitization).
 */
export function renderByTeamRows(
  tbody: HTMLTableSectionElement,
  items: ReadonlyArray<VerifiedAchievementByTeam>,
): void {
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-testid', REPORT_TEST_IDS.byTeamRow);
    tr.setAttribute('data-team-id', item.teamId);
    const cells: ReadonlyArray<readonly [string, string]> = [
      ['team', item.teamName],
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

/**
 * Render the by-sport aggregation into the supplied `<tbody>`. Mirrors
 * `renderByTeamRows` — same security posture (textContent only), same
 * row/cell shape (one cell per published column).
 */
export function renderBySportRows(
  tbody: HTMLTableSectionElement,
  items: ReadonlyArray<VerifiedAchievementBySport>,
): void {
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-testid', REPORT_TEST_IDS.bySportRow);
    tr.setAttribute('data-sport', item.sport);
    const cells: ReadonlyArray<readonly [string, string]> = [
      ['sport', item.sport],
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
