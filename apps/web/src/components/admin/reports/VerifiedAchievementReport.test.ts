// apps/web/src/components/admin/reports/VerifiedAchievementReport.test.ts
//
// Unit tests for the pure-TS helpers behind the verified-achievement
// admin report page (Epic #10 / Story #679 / Task #699). The companion
// `.astro` renderer is exercised at the acceptance tier (Task #700).
// These tests pin:
//
//   - `REPORT_TEST_IDS` constants stay stable (load-bearing for the
//     acceptance suite — any change is a coordinated cross-tier edit).
//   - `renderByTeamRows` and `renderBySportRows` produce one `<tr>`
//     per item with the canonical row data-testid and per-cell
//     `data-col` markers, and use `textContent` (never `innerHTML`)
//     for every cell value.
//   - Re-rendering clears the previous content (no row leakage).

import type {
  VerifiedAchievementBySport,
  VerifiedAchievementByTeam,
} from '@repo/shared/schemas/admin/reports';
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  REPORT_TEST_IDS,
  renderBySportRows,
  renderByTeamRows,
} from './VerifiedAchievementReport';

describe('REPORT_TEST_IDS — canonical data-testid contract', () => {
  it('exposes the by-team and by-sport selectors the acceptance suite targets', () => {
    expect(REPORT_TEST_IDS.byTeamTable).toBe('admin-report-by-team');
    expect(REPORT_TEST_IDS.bySportTable).toBe('admin-report-by-sport');
  });
});

describe('renderByTeamRows', () => {
  let tbody: HTMLTableSectionElement;

  beforeEach(() => {
    document.body.innerHTML = '<table><tbody id="t"></tbody></table>';
    tbody = document.querySelector<HTMLTableSectionElement>('#t') as HTMLTableSectionElement;
  });

  it('renders one row per item with the canonical data-testid', () => {
    const items: VerifiedAchievementByTeam[] = [
      { teamId: 't_a', teamName: 'A-Team', verifiedAchievementCount: 0 },
      { teamId: 't_b', teamName: 'B-Team', verifiedAchievementCount: 0 },
    ];
    renderByTeamRows(tbody, items);
    const rows = tbody.querySelectorAll<HTMLTableRowElement>('tr');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute('data-testid')).toBe('admin-report-by-team-row');
    }
    expect(rows[0]?.getAttribute('data-team-id')).toBe('t_a');
    expect(rows[1]?.getAttribute('data-team-id')).toBe('t_b');
  });

  it('uses textContent for cells (never innerHTML)', () => {
    // If the implementation switches to innerHTML, the `<script>` tag
    // will execute (or at least be parsed); textContent renders the
    // raw string verbatim.
    const items: VerifiedAchievementByTeam[] = [
      { teamId: 't_x', teamName: '<script>1</script>', verifiedAchievementCount: 0 },
    ];
    renderByTeamRows(tbody, items);
    const cell = tbody.querySelector<HTMLTableCellElement>('td[data-col="team"]');
    expect(cell?.textContent).toBe('<script>1</script>');
    expect(cell?.querySelector('script')).toBeNull();
  });

  it('clears previous content on re-render', () => {
    renderByTeamRows(tbody, [
      { teamId: 't_1', teamName: 'One', verifiedAchievementCount: 0 },
    ]);
    renderByTeamRows(tbody, [
      { teamId: 't_2', teamName: 'Two', verifiedAchievementCount: 0 },
    ]);
    const rows = tbody.querySelectorAll<HTMLTableRowElement>('tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-team-id')).toBe('t_2');
  });
});

describe('renderBySportRows', () => {
  let tbody: HTMLTableSectionElement;

  beforeEach(() => {
    document.body.innerHTML = '<table><tbody id="t"></tbody></table>';
    tbody = document.querySelector<HTMLTableSectionElement>('#t') as HTMLTableSectionElement;
  });

  it('renders one row per item with the canonical data-testid', () => {
    const items: VerifiedAchievementBySport[] = [
      { sport: 'Basketball', verifiedAchievementCount: 0 },
      { sport: 'Volleyball', verifiedAchievementCount: 0 },
    ];
    renderBySportRows(tbody, items);
    const rows = tbody.querySelectorAll<HTMLTableRowElement>('tr');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute('data-testid')).toBe('admin-report-by-sport-row');
    }
    expect(rows[0]?.getAttribute('data-sport')).toBe('Basketball');
    expect(rows[1]?.getAttribute('data-sport')).toBe('Volleyball');
  });

  it('renders the count as a string in the verified-count cell', () => {
    renderBySportRows(tbody, [
      { sport: 'Tennis', verifiedAchievementCount: 0 },
    ]);
    const cell = tbody.querySelector<HTMLTableCellElement>('td[data-col="verified-count"]');
    expect(cell?.textContent).toBe('0');
  });
});
