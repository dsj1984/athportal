// apps/web/src/components/admin/ImportHistory.ts
//
// Pure-TS view-shape and rendering helpers for the org-admin
// "Import history" surface on `/admin/import` (Story #974 F2). The
// `.astro` sibling (`ImportHistory.astro`) renders the empty table
// shell + empty-state placeholder; the inline `<script>` on the
// import page calls `fetchImportHistory` + `renderImportHistoryRows`
// to populate the table on first render and after every successful
// commit.
//
// Why pure-TS rather than a React island? `@repo/web` does not wire
// `@astrojs/react` for admin surfaces (see the precedent set by
// `roster/RosterTable.ts`). Pairing an `.astro` shell with a
// sibling `.ts` module keeps the data-testid contract under unit-
// tier control and avoids standing up the full island toolchain
// for what is a read-only list view.
//
// Wire contract: `GET /api/v1/admin/csv-import/batches` returns
// `{ success: true, data: { batches: CsvImportBatchSummary[] } }`,
// newest first, scoped to the actor's org by the API edge. Story
// #973 F1 ships this endpoint.

import type { CsvImportBatchSummary } from '@repo/shared/schemas/admin/csvImport';

/**
 * Canonical data-testid values exposed by the import-history surface.
 * Locked by Story #974 F2 so acceptance scenarios can target stable
 * selectors. ANY change here is a breaking change to the acceptance
 * suite — bump the suite in the same PR.
 */
export const IMPORT_HISTORY_TEST_IDS = {
  section: 'admin-import-history',
  table: 'admin-import-history-table',
  tbody: 'admin-import-history-tbody',
  row: 'admin-import-history-row',
  emptyState: 'admin-import-history-empty',
  error: 'admin-import-history-error',
} as const;

/**
 * Status label rendered in the table per batch. Today's contract is a
 * derived view over `successCount` / `errorCount`: every persisted
 * batch is a successful commit (failed commits roll back the audit
 * row), but a future per-row partial-failure mode would surface
 * `errorCount > 0` here. Kept as a pure function so the unit tier
 * can pin the label boundary without booting the DOM renderer.
 */
export function deriveBatchStatus(batch: {
  rowCount: number;
  successCount: number;
  errorCount: number;
}): 'Succeeded' | 'Partial' | 'Failed' {
  if (batch.errorCount > 0 && batch.successCount === 0) return 'Failed';
  if (batch.errorCount > 0) return 'Partial';
  return 'Succeeded';
}

/**
 * Format an ISO-8601 timestamp into a compact local-time label
 * (`YYYY-MM-DD HH:MM`). The wire shape is the server's
 * `Date.toISOString()` output; rendering locally keeps the surface
 * legible without pulling in a date library.
 *
 * Invalid input falls through to the raw value so a malformed
 * server response is visible to a reviewer rather than silently
 * blanked.
 */
export function formatImportTimestamp(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const d = new Date(ts);
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/**
 * Render the current set of import batches into the supplied
 * `<tbody>`. The function fully replaces the tbody's content — the
 * import page reuses this helper for both the initial render and the
 * post-commit refresh.
 *
 * Cells are populated via `textContent`, never `innerHTML`, so the
 * server-supplied projection (filename, in particular) cannot inject
 * markup on the client. Per
 * `.agents/rules/security-baseline.md` § Output & Rendering —
 * `innerHTML` MUST NOT receive user-provided data without sanitization.
 */
export function renderImportHistoryRows(
  tbody: HTMLTableSectionElement,
  batches: ReadonlyArray<CsvImportBatchSummary>,
): void {
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  for (const b of batches) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-testid', IMPORT_HISTORY_TEST_IDS.row);
    tr.setAttribute('data-batch-id', b.id);
    const cells: ReadonlyArray<readonly [string, string]> = [
      ['timestamp', formatImportTimestamp(b.createdAt)],
      ['file-name', b.fileName],
      ['row-count', String(b.rowCount)],
      ['success-count', String(b.successCount)],
      ['error-count', String(b.errorCount)],
      ['status', deriveBatchStatus(b)],
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
