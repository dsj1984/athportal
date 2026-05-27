// apps/web/src/components/admin/ImportHistory.test.ts
//
// Unit tests for the pure-TS helpers behind the admin import-history
// surface on `/admin/import` (Story #974 F2). Pins:
//
//   - `IMPORT_HISTORY_TEST_IDS` constants stay stable (load-bearing
//     for the acceptance suite).
//   - `deriveBatchStatus` returns the documented label for each
//     success/error split.
//   - `formatImportTimestamp` returns a deterministic
//     `YYYY-MM-DD HH:MM` shape and falls through on malformed input.
//   - `renderImportHistoryRows` produces one `<tr>` per batch with
//     the canonical row data-testid and per-cell `data-col` markers,
//     and uses `textContent` (never `innerHTML`) for every cell.

import type { CsvImportBatchSummary } from '@repo/shared/schemas/admin/csvImport';
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IMPORT_HISTORY_TEST_IDS,
  deriveBatchStatus,
  formatImportTimestamp,
  renderImportHistoryRows,
} from './ImportHistory';

describe('IMPORT_HISTORY_TEST_IDS — canonical data-testid contract', () => {
  it('exposes every selector the acceptance suite targets', () => {
    expect(IMPORT_HISTORY_TEST_IDS.section).toBe('admin-import-history');
    expect(IMPORT_HISTORY_TEST_IDS.table).toBe('admin-import-history-table');
    expect(IMPORT_HISTORY_TEST_IDS.tbody).toBe('admin-import-history-tbody');
    expect(IMPORT_HISTORY_TEST_IDS.row).toBe('admin-import-history-row');
    expect(IMPORT_HISTORY_TEST_IDS.emptyState).toBe('admin-import-history-empty');
    expect(IMPORT_HISTORY_TEST_IDS.error).toBe('admin-import-history-error');
  });
});

describe('deriveBatchStatus', () => {
  it('returns Succeeded when there are no errors', () => {
    expect(deriveBatchStatus({ rowCount: 10, successCount: 10, errorCount: 0 })).toBe('Succeeded');
  });

  it('returns Partial when some rows failed but others succeeded', () => {
    expect(deriveBatchStatus({ rowCount: 10, successCount: 7, errorCount: 3 })).toBe('Partial');
  });

  it('returns Failed when every row failed', () => {
    expect(deriveBatchStatus({ rowCount: 5, successCount: 0, errorCount: 5 })).toBe('Failed');
  });
});

describe('formatImportTimestamp', () => {
  it('formats a valid ISO-8601 string as YYYY-MM-DD HH:MM (local time)', () => {
    // Pin the input to a moment in the middle of a day so DST / TZ
    // boundary cases do not flip the output's date component for any
    // reviewer timezone. We assert the regex shape rather than the
    // exact value because the helper renders in local time.
    const out = formatImportTimestamp('2026-05-20T12:34:56.000Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('falls through to the raw value when the input is not a valid date', () => {
    expect(formatImportTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('renderImportHistoryRows', () => {
  let tbody: HTMLTableSectionElement;

  beforeEach(() => {
    document.body.innerHTML = '<table><tbody></tbody></table>';
    const t = document.body.querySelector('tbody');
    if (!t) throw new Error('tbody missing');
    tbody = t;
  });

  function makeBatch(overrides: Partial<CsvImportBatchSummary> = {}): CsvImportBatchSummary {
    return {
      id: 'cib_one',
      fileName: 'roster.csv',
      rowCount: 10,
      successCount: 10,
      errorCount: 0,
      createdAt: '2026-05-20T12:34:56.000Z',
      ...overrides,
    };
  }

  it('renders one row per batch with the canonical row data-testid', () => {
    renderImportHistoryRows(tbody, [
      makeBatch({ id: 'cib_a', fileName: 'a.csv' }),
      makeBatch({ id: 'cib_b', fileName: 'b.csv' }),
    ]);
    const rows = tbody.querySelectorAll(`tr[data-testid="${IMPORT_HISTORY_TEST_IDS.row}"]`);
    expect(rows).toHaveLength(2);
    expect((rows[0] as HTMLElement).dataset.batchId).toBe('cib_a');
    expect((rows[1] as HTMLElement).dataset.batchId).toBe('cib_b');
  });

  it('populates per-column cells via textContent (no HTML injection)', () => {
    renderImportHistoryRows(tbody, [
      makeBatch({
        fileName: '<img src=x onerror=alert(1)>.csv',
      }),
    ]);
    const cells = tbody.querySelectorAll('td');
    // 6 columns: timestamp, file-name, row-count, success-count,
    // error-count, status.
    expect(cells).toHaveLength(6);
    const fileNameCell = tbody.querySelector('td[data-col="file-name"]');
    expect(fileNameCell?.textContent).toBe('<img src=x onerror=alert(1)>.csv');
    expect(fileNameCell?.innerHTML).not.toContain('<img');
  });

  it('renders row / success / error counts as strings', () => {
    renderImportHistoryRows(tbody, [makeBatch({ rowCount: 12, successCount: 11, errorCount: 1 })]);
    expect(tbody.querySelector('td[data-col="row-count"]')?.textContent).toBe('12');
    expect(tbody.querySelector('td[data-col="success-count"]')?.textContent).toBe('11');
    expect(tbody.querySelector('td[data-col="error-count"]')?.textContent).toBe('1');
    expect(tbody.querySelector('td[data-col="status"]')?.textContent).toBe('Partial');
  });

  it('clears prior rows on re-render', () => {
    renderImportHistoryRows(tbody, [makeBatch({ id: 'cib_first' })]);
    renderImportHistoryRows(tbody, [makeBatch({ id: 'cib_second' })]);
    const rows = tbody.querySelectorAll('tr');
    expect(rows).toHaveLength(1);
    expect((rows[0] as HTMLElement).dataset.batchId).toBe('cib_second');
  });
});
