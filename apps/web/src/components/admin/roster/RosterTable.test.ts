// apps/web/src/components/admin/roster/RosterTable.test.ts
//
// Unit tests for the pure-TS helpers behind the org-wide roster admin
// page (Epic #10 / Story #661 / Task #693). The companion `.astro`
// renderer is exercised at the acceptance tier (Task #691). These
// tests pin:
//
//   - `ROSTER_TEST_IDS` constants stay stable (load-bearing for the
//     acceptance suite — any change is a coordinated cross-tier edit).
//   - `buildRosterQuery` only emits non-empty filter values and the
//     opaque cursor.
//   - `renderRosterRows` produces one `<tr>` per item with the
//     canonical row data-testid and per-cell `data-col` markers, and
//     uses `textContent` (never `innerHTML`) for every cell value.

import type { RosterItem } from '@repo/shared/schemas/admin/roster';
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ROSTER_TEST_IDS, buildRosterQuery, renderRosterRows } from './RosterTable';

describe('ROSTER_TEST_IDS — canonical data-testid contract', () => {
  it('exposes every selector the acceptance suite targets', () => {
    expect(ROSTER_TEST_IDS.table).toBe('admin-roster-table');
    expect(ROSTER_TEST_IDS.filterTeam).toBe('admin-roster-filter-team');
    expect(ROSTER_TEST_IDS.filterSport).toBe('admin-roster-filter-sport');
    expect(ROSTER_TEST_IDS.nextPage).toBe('admin-roster-next-page');
  });
});

describe('buildRosterQuery', () => {
  it('returns the empty string when no filters or cursor are supplied', () => {
    expect(buildRosterQuery({})).toBe('');
  });

  it('emits only non-empty filter values', () => {
    expect(buildRosterQuery({ teamId: 't_one', sport: '' })).toBe('?teamId=t_one');
  });

  it('emits all three keys when supplied', () => {
    const qs = buildRosterQuery({
      teamId: 't_one',
      sport: 'Volleyball',
      cursor: 'am_42',
    });
    // URLSearchParams orders insertion; pin the full string so we
    // catch accidental re-orderings (the API does not care, but the
    // acceptance suite spies on the request URL).
    expect(qs).toBe('?teamId=t_one&sport=Volleyball&cursor=am_42');
  });
});

describe('renderRosterRows', () => {
  let tbody: HTMLTableSectionElement;

  beforeEach(() => {
    document.body.innerHTML = '<table><tbody></tbody></table>';
    const t = document.body.querySelector('tbody');
    if (!t) throw new Error('tbody missing');
    tbody = t;
  });

  function makeItem(overrides: Partial<RosterItem> = {}): RosterItem {
    return {
      membershipId: 'am_ada',
      athleteId: 'u_ada',
      fullName: 'Ada Lovelace',
      teamId: 't_one',
      teamName: 'Team One',
      sport: 'Volleyball',
      ageGroup: 'U14',
      verifiedAchievementCount: 0,
      ...overrides,
    };
  }

  it('renders one row per athlete with the canonical row data-testid', () => {
    renderRosterRows(tbody, [
      makeItem({ athleteId: 'u_a', fullName: 'Athlete A' }),
      makeItem({ athleteId: 'u_b', fullName: 'Athlete B' }),
    ]);
    const rows = tbody.querySelectorAll(`tr[data-testid="${ROSTER_TEST_IDS.row}"]`);
    expect(rows).toHaveLength(2);
    expect((rows[0] as HTMLElement).dataset.athleteId).toBe('u_a');
    expect((rows[1] as HTMLElement).dataset.athleteId).toBe('u_b');
  });

  it('populates per-column cells via textContent (no HTML injection)', () => {
    renderRosterRows(tbody, [
      makeItem({
        fullName: '<img src=x onerror=alert(1)>',
        teamName: 'Team & Co',
      }),
    ]);
    const cells = tbody.querySelectorAll('td');
    expect(cells).toHaveLength(5);
    // The malicious payload is rendered as literal text, not parsed.
    expect((cells[0] as HTMLElement).textContent).toBe('<img src=x onerror=alert(1)>');
    expect((cells[0] as HTMLElement).innerHTML).not.toContain('<img');
    expect((cells[1] as HTMLElement).textContent).toBe('Team & Co');
  });

  it('renders the verified-achievement count as a string', () => {
    renderRosterRows(tbody, [makeItem({ verifiedAchievementCount: 7 })]);
    const td = tbody.querySelector('td[data-col="verified-count"]');
    expect(td?.textContent).toBe('7');
  });

  it('clears prior rows on re-render', () => {
    renderRosterRows(tbody, [makeItem({ athleteId: 'u_first' })]);
    renderRosterRows(tbody, [makeItem({ athleteId: 'u_second' })]);
    const rows = tbody.querySelectorAll('tr');
    expect(rows).toHaveLength(1);
    expect((rows[0] as HTMLElement).dataset.athleteId).toBe('u_second');
  });
});
