// apps/web/src/components/coach/RosterTable.test.ts
//
// Unit tests for the pure-TS helpers behind the coach roster page
// (Epic #11 / Story #912 / Task #918). The companion `.astro`
// renderer is exercised at the acceptance tier (out of scope for this
// Story — covered by a future Wave's Playwright suite). These tests
// pin:
//
//   - `COACH_ROSTER_TEST_IDS` constants stay stable. Load-bearing for
//     the acceptance suite — any change is a coordinated cross-tier
//     edit.
//   - `buildRosterUrl` URL-encodes the teamId.
//   - `renderRosterRows` produces one `<tr>` per item with the
//     canonical row data-testid and per-cell `data-col` markers, and
//     uses `textContent` (never `innerHTML`) for every cell value.

// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  COACH_ROSTER_TEST_IDS,
  type CoachRosterEntry,
  buildRosterUrl,
  renderRosterRows,
} from './RosterTable';

describe('COACH_ROSTER_TEST_IDS — canonical data-testid contract', () => {
  it('exposes every selector the acceptance suite targets', () => {
    expect(COACH_ROSTER_TEST_IDS.root).toBe('coach-roster-root');
    expect(COACH_ROSTER_TEST_IDS.row).toBe('coach-roster-row');
    expect(COACH_ROSTER_TEST_IDS.jersey).toBe('coach-roster-jersey');
    expect(COACH_ROSTER_TEST_IDS.position).toBe('coach-roster-position');
    expect(COACH_ROSTER_TEST_IDS.badge).toBe('coach-roster-badge');
  });
});

describe('buildRosterUrl', () => {
  it('returns the canonical API path with the teamId URL-encoded', () => {
    expect(buildRosterUrl('t_one')).toBe('/api/v1/coach/teams/t_one/roster');
  });

  it('encodes special characters in the teamId', () => {
    expect(buildRosterUrl('t one')).toBe('/api/v1/coach/teams/t%20one/roster');
  });
});

describe('renderRosterRows', () => {
  let tbody: HTMLTableSectionElement;

  beforeEach(() => {
    const table = document.createElement('table');
    tbody = document.createElement('tbody');
    table.appendChild(tbody);
    document.body.appendChild(table);
  });

  function row(overrides: Partial<CoachRosterEntry> = {}): CoachRosterEntry {
    return {
      id: 're_default',
      teamId: 't_default',
      athleteUserId: 'u_default',
      athleteEmail: 'default@test.invalid',
      athleteFullName: 'Default Athlete',
      jerseyNumber: '7',
      primaryPosition: 'Setter',
      ...overrides,
    };
  }

  it('renders one <tr> per item with the canonical row data-testid', () => {
    renderRosterRows(tbody, [
      row({ id: 're_a', athleteFullName: 'Ada Lovelace' }),
      row({ id: 're_b', athleteFullName: 'Bob Hopper' }),
    ]);

    const rows = tbody.querySelectorAll('tr');
    expect(rows).toHaveLength(2);
    for (const tr of rows) {
      expect(tr.getAttribute('data-testid')).toBe('coach-roster-row');
    }
    expect(rows[0]?.getAttribute('data-roster-entry-id')).toBe('re_a');
  });

  it('attaches per-cell testids for jersey, position, and badge', () => {
    renderRosterRows(tbody, [
      row({ id: 're_one', jerseyNumber: '07', primaryPosition: 'Setter' }),
    ]);

    const tr = tbody.querySelector('tr');
    expect(tr).not.toBeNull();
    expect(
      tr?.querySelector('[data-testid="coach-roster-jersey"]')?.textContent,
    ).toBe('07');
    expect(
      tr?.querySelector('[data-testid="coach-roster-position"]')?.textContent,
    ).toBe('Setter');
    expect(
      tr?.querySelector('[data-testid="coach-roster-badge"]')?.textContent,
    ).toBe('Setter');
  });

  it('substitutes an em-dash when jersey or position is null', () => {
    renderRosterRows(tbody, [
      row({ jerseyNumber: null, primaryPosition: null }),
    ]);

    const tr = tbody.querySelector('tr');
    expect(
      tr?.querySelector('[data-testid="coach-roster-jersey"]')?.textContent,
    ).toBe('—');
    expect(
      tr?.querySelector('[data-testid="coach-roster-position"]')?.textContent,
    ).toBe('—');
  });

  it('uses textContent, never innerHTML, for cell values', () => {
    // A name carrying a `<script>` literal must NOT be parsed as HTML
    // by the renderer — it must appear as visible text instead.
    const malicious = row({ athleteFullName: '<script>alert(1)</script>' });
    renderRosterRows(tbody, [malicious]);

    const tr = tbody.querySelector('tr');
    // The cell's child should be a Text node, not an Element — the
    // dangerous payload was rendered as plain text.
    const nameCell = tr?.querySelector('td[data-col="name"]');
    expect(nameCell?.textContent).toBe('<script>alert(1)</script>');
    expect(nameCell?.querySelector('script')).toBeNull();
  });

  it('clears the tbody on re-render rather than appending', () => {
    renderRosterRows(tbody, [row({ id: 're_first' })]);
    expect(tbody.querySelectorAll('tr')).toHaveLength(1);

    renderRosterRows(tbody, [row({ id: 're_second' }), row({ id: 're_third' })]);
    const ids = Array.from(tbody.querySelectorAll('tr')).map((tr) =>
      tr.getAttribute('data-roster-entry-id'),
    );
    expect(ids).toEqual(['re_second', 're_third']);
  });
});
