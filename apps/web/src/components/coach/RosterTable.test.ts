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
  buildEntryUrl,
  buildPatchPayload,
  buildRosterUrl,
  enterEditMode,
  exitEditMode,
  hideJerseyWarning,
  readEditValues,
  removeRow,
  renderRosterRows,
  showJerseyWarning,
} from './RosterTable';

describe('COACH_ROSTER_TEST_IDS — canonical data-testid contract', () => {
  it('exposes every selector the acceptance suite targets', () => {
    expect(COACH_ROSTER_TEST_IDS.root).toBe('coach-roster-root');
    expect(COACH_ROSTER_TEST_IDS.row).toBe('coach-roster-row');
    expect(COACH_ROSTER_TEST_IDS.jersey).toBe('coach-roster-jersey');
    expect(COACH_ROSTER_TEST_IDS.position).toBe('coach-roster-position');
    expect(COACH_ROSTER_TEST_IDS.badge).toBe('coach-roster-badge');
  });

  it('exposes the Task #928 mutation selectors without renaming the Task #918 ids', () => {
    // Task #928 invariance — the seven Task #918 ids above MUST keep
    // their string values. The new mutation ids are additive.
    expect(COACH_ROSTER_TEST_IDS.editBtn).toBe('coach-roster-edit-btn');
    expect(COACH_ROSTER_TEST_IDS.saveBtn).toBe('coach-roster-save-btn');
    expect(COACH_ROSTER_TEST_IDS.cancelBtn).toBe('coach-roster-cancel-btn');
    expect(COACH_ROSTER_TEST_IDS.removeBtn).toBe('coach-roster-remove-btn');
    expect(COACH_ROSTER_TEST_IDS.jerseyWarning).toBe('coach-roster-jersey-warning');
    expect(COACH_ROSTER_TEST_IDS.jerseyInput).toBe('coach-roster-jersey-input');
    expect(COACH_ROSTER_TEST_IDS.positionInput).toBe('coach-roster-position-input');
    expect(COACH_ROSTER_TEST_IDS.removeConfirm).toBe('coach-roster-remove-confirm');
    expect(COACH_ROSTER_TEST_IDS.removeConfirmYes).toBe('coach-roster-remove-confirm-yes');
    expect(COACH_ROSTER_TEST_IDS.removeConfirmCancel).toBe('coach-roster-remove-confirm-cancel');
  });
});

describe('buildEntryUrl', () => {
  it('returns the canonical PATCH/DELETE URL with both segments URL-encoded', () => {
    expect(buildEntryUrl('t one', 'e&one')).toBe(
      '/api/v1/coach/teams/t%20one/roster/entries/e%26one',
    );
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
    renderRosterRows(tbody, [row({ id: 're_one', jerseyNumber: '07', primaryPosition: 'Setter' })]);

    const tr = tbody.querySelector('tr');
    expect(tr).not.toBeNull();
    expect(tr?.querySelector('[data-testid="coach-roster-jersey"]')?.textContent).toBe('07');
    expect(tr?.querySelector('[data-testid="coach-roster-position"]')?.textContent).toBe('Setter');
    expect(tr?.querySelector('[data-testid="coach-roster-badge"]')?.textContent).toBe('Setter');
  });

  it('substitutes an em-dash when jersey or position is null', () => {
    renderRosterRows(tbody, [row({ jerseyNumber: null, primaryPosition: null })]);

    const tr = tbody.querySelector('tr');
    expect(tr?.querySelector('[data-testid="coach-roster-jersey"]')?.textContent).toBe('—');
    expect(tr?.querySelector('[data-testid="coach-roster-position"]')?.textContent).toBe('—');
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

  it('seeds per-row Edit + Remove buttons and a hidden save/cancel + warning slot', () => {
    renderRosterRows(tbody, [row()]);
    const tr = tbody.querySelector('tr');
    expect(tr).not.toBeNull();
    expect(
      tr?.querySelector(`button[data-testid="${COACH_ROSTER_TEST_IDS.editBtn}"]`),
    ).not.toBeNull();
    expect(
      tr?.querySelector(`button[data-testid="${COACH_ROSTER_TEST_IDS.removeBtn}"]`),
    ).not.toBeNull();
    const save = tr?.querySelector<HTMLButtonElement>(
      `button[data-testid="${COACH_ROSTER_TEST_IDS.saveBtn}"]`,
    );
    const cancel = tr?.querySelector<HTMLButtonElement>(
      `button[data-testid="${COACH_ROSTER_TEST_IDS.cancelBtn}"]`,
    );
    expect(save?.hidden).toBe(true);
    expect(cancel?.hidden).toBe(true);
    const warning = tr?.querySelector<HTMLElement>(
      `[data-testid="${COACH_ROSTER_TEST_IDS.jerseyWarning}"]`,
    );
    expect(warning?.hidden).toBe(true);
  });
});

describe('enterEditMode / exitEditMode', () => {
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

  it('replaces jersey/position text with Input primitives and reveals save/cancel', () => {
    renderRosterRows(tbody, [row({ jerseyNumber: '07', primaryPosition: 'Setter' })]);
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    expect(tr).not.toBeNull();
    if (!tr) return;

    enterEditMode(tr);

    const jerseyInput = tr.querySelector<HTMLInputElement>(
      `input[data-testid="${COACH_ROSTER_TEST_IDS.jerseyInput}"]`,
    );
    const positionInput = tr.querySelector<HTMLInputElement>(
      `input[data-testid="${COACH_ROSTER_TEST_IDS.positionInput}"]`,
    );
    expect(jerseyInput?.value).toBe('07');
    expect(positionInput?.value).toBe('Setter');

    const saveBtn = tr.querySelector<HTMLButtonElement>(
      `button[data-testid="${COACH_ROSTER_TEST_IDS.saveBtn}"]`,
    );
    const editBtn = tr.querySelector<HTMLButtonElement>(
      `button[data-testid="${COACH_ROSTER_TEST_IDS.editBtn}"]`,
    );
    expect(saveBtn?.hidden).toBe(false);
    expect(editBtn?.hidden).toBe(true);
  });

  it('restores the original cells on cancel', () => {
    renderRosterRows(tbody, [row({ jerseyNumber: '07', primaryPosition: 'Setter' })]);
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    if (!tr) return;
    enterEditMode(tr);
    // Mutate input values — cancel should ignore them.
    const jerseyInput = tr.querySelector<HTMLInputElement>(
      `input[data-testid="${COACH_ROSTER_TEST_IDS.jerseyInput}"]`,
    );
    if (jerseyInput) jerseyInput.value = '99';

    exitEditMode(tr);

    const jerseyTd = tr.querySelector<HTMLElement>('td[data-col="jersey"]');
    const positionTd = tr.querySelector<HTMLElement>('td[data-col="position"]');
    expect(jerseyTd?.textContent).toBe('07');
    expect(positionTd?.textContent).toBe('Setter');
    expect(jerseyTd?.querySelector('input')).toBeNull();
  });

  it('applies server-returned values on save', () => {
    renderRosterRows(tbody, [row({ jerseyNumber: '07', primaryPosition: 'Setter' })]);
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    if (!tr) return;
    enterEditMode(tr);
    exitEditMode(tr, { jerseyNumber: '11', primaryPosition: 'Libero' });

    const jerseyTd = tr.querySelector<HTMLElement>('td[data-col="jersey"]');
    const positionTd = tr.querySelector<HTMLElement>('td[data-col="position"]');
    const badgeTd = tr.querySelector<HTMLElement>(`[data-testid="${COACH_ROSTER_TEST_IDS.badge}"]`);
    expect(jerseyTd?.textContent).toBe('11');
    expect(positionTd?.textContent).toBe('Libero');
    expect(badgeTd?.textContent).toBe('Libero');
  });
});

describe('readEditValues / buildPatchPayload', () => {
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

  it('reads trimmed values and treats empty strings as null', () => {
    renderRosterRows(tbody, [row({ jerseyNumber: '7', primaryPosition: 'Setter' })]);
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    if (!tr) return;
    enterEditMode(tr);
    const jerseyInput = tr.querySelector<HTMLInputElement>(
      `input[data-testid="${COACH_ROSTER_TEST_IDS.jerseyInput}"]`,
    );
    const positionInput = tr.querySelector<HTMLInputElement>(
      `input[data-testid="${COACH_ROSTER_TEST_IDS.positionInput}"]`,
    );
    if (jerseyInput) jerseyInput.value = '  11  ';
    if (positionInput) positionInput.value = '';

    const values = readEditValues(tr);
    expect(values).toEqual({ jerseyNumber: '11', primaryPosition: null });
  });

  it('builds a minimal patch with only changed fields', () => {
    renderRosterRows(tbody, [row({ jerseyNumber: '7', primaryPosition: 'Setter' })]);
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    if (!tr) return;
    enterEditMode(tr);

    // Change only jersey.
    const patch = buildPatchPayload(tr, { jerseyNumber: '11', primaryPosition: 'Setter' });
    expect(patch).toEqual({ jerseyNumber: '11' });
  });

  it('returns null when nothing changed', () => {
    renderRosterRows(tbody, [row({ jerseyNumber: '7', primaryPosition: 'Setter' })]);
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    if (!tr) return;
    enterEditMode(tr);
    expect(buildPatchPayload(tr, { jerseyNumber: '7', primaryPosition: 'Setter' })).toBeNull();
  });
});

describe('showJerseyWarning / hideJerseyWarning', () => {
  let tbody: HTMLTableSectionElement;

  beforeEach(() => {
    const table = document.createElement('table');
    tbody = document.createElement('tbody');
    table.appendChild(tbody);
    document.body.appendChild(table);
  });

  function row(): CoachRosterEntry {
    return {
      id: 're_default',
      teamId: 't_default',
      athleteUserId: 'u_default',
      athleteEmail: 'default@test.invalid',
      athleteFullName: 'Default Athlete',
      jerseyNumber: '7',
      primaryPosition: 'Setter',
    };
  }

  it('reveals the warning slot with the jersey number embedded in the copy', () => {
    renderRosterRows(tbody, [row()]);
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    if (!tr) return;
    showJerseyWarning(tr, '11');
    const slot = tr.querySelector<HTMLElement>(
      `[data-testid="${COACH_ROSTER_TEST_IDS.jerseyWarning}"]`,
    );
    expect(slot?.hidden).toBe(false);
    expect(slot?.textContent).toContain('#11');
  });

  it('hides the slot and clears its content', () => {
    renderRosterRows(tbody, [row()]);
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    if (!tr) return;
    showJerseyWarning(tr, '11');
    hideJerseyWarning(tr);
    const slot = tr.querySelector<HTMLElement>(
      `[data-testid="${COACH_ROSTER_TEST_IDS.jerseyWarning}"]`,
    );
    expect(slot?.hidden).toBe(true);
    expect(slot?.textContent).toBe('');
  });
});

describe('removeRow', () => {
  it('removes the row from its parent tbody', () => {
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    document.body.appendChild(table);
    renderRosterRows(tbody, [
      {
        id: 're_a',
        teamId: 't',
        athleteUserId: 'u',
        athleteEmail: 'a@test.invalid',
        athleteFullName: 'A',
        jerseyNumber: '1',
        primaryPosition: 'P',
      },
    ]);
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    expect(tr).not.toBeNull();
    if (!tr) return;
    removeRow(tr);
    expect(tbody.querySelectorAll('tr')).toHaveLength(0);
  });
});
