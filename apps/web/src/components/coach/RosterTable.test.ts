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
  attachRowActions,
  buildEntryUrl,
  buildPatchPayload,
  buildRosterUrl,
  enterEditMode,
  exitEditMode,
  hideJerseyWarning,
  hideRowError,
  mountRemoveConfirm,
  readEditValues,
  removeRow,
  renderRosterRows,
  showJerseyWarning,
  showRowError,
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
    expect(COACH_ROSTER_TEST_IDS.rowError).toBe('coach-roster-row-error');
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

describe('showRowError / hideRowError', () => {
  let tbody: HTMLTableSectionElement;

  beforeEach(() => {
    const table = document.createElement('table');
    tbody = document.createElement('tbody');
    table.appendChild(tbody);
    document.body.appendChild(table);
    renderRosterRows(tbody, [
      {
        id: 're_a',
        teamId: 't_one',
        athleteUserId: 'u',
        athleteEmail: 'a@test.invalid',
        athleteFullName: 'Ada Lovelace',
        jerseyNumber: '7',
        primaryPosition: 'Setter',
      },
    ]);
  });

  it('reveals the row error slot with the message and hides it again', () => {
    const tr = tbody.querySelector<HTMLTableRowElement>('tr');
    if (!tr) throw new Error('row missing');
    const slot = tr.querySelector<HTMLElement>('[data-testid="coach-roster-row-error"]');
    expect(slot?.hidden).toBe(true);

    showRowError(tr, 'jerseyNumber must be 1-3 digits');
    expect(slot?.hidden).toBe(false);
    expect(slot?.textContent).toBe('jerseyNumber must be 1-3 digits');

    hideRowError(tr);
    expect(slot?.hidden).toBe(true);
    expect(slot?.textContent).toBe('');
  });
});

describe('mountRemoveConfirm', () => {
  it('mounts a single confirm dialog with the canonical testids', () => {
    mountRemoveConfirm('Ada Lovelace');
    mountRemoveConfirm('Ada Lovelace');
    const dialogs = document.querySelectorAll('dialog[data-testid="coach-roster-remove-confirm"]');
    expect(dialogs).toHaveLength(1);
    const dialog = dialogs[0];
    expect(dialog?.querySelector('[data-testid="coach-roster-remove-confirm-yes"]')).not.toBeNull();
    expect(
      dialog?.querySelector('[data-testid="coach-roster-remove-confirm-cancel"]'),
    ).not.toBeNull();
    expect(dialog?.textContent).toContain('Ada Lovelace');
    dialog?.remove();
  });
});

describe('attachRowActions', () => {
  let tbody: HTMLTableSectionElement;

  beforeEach(() => {
    const table = document.createElement('table');
    tbody = document.createElement('tbody');
    table.appendChild(tbody);
    document.body.appendChild(table);
    renderRosterRows(tbody, [
      {
        id: 're_a',
        teamId: 't_one',
        athleteUserId: 'u',
        athleteEmail: 'a@test.invalid',
        athleteFullName: 'Ada Lovelace',
        jerseyNumber: '7',
        primaryPosition: 'Setter',
      },
    ]);
  });

  function click(testId: string, root: ParentNode = tbody): void {
    root
      .querySelector<HTMLButtonElement>(`button[data-testid="${testId}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('Edit click swaps the row into edit mode', () => {
    attachRowActions(
      tbody,
      't_one',
      (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    );
    click(COACH_ROSTER_TEST_IDS.editBtn);
    expect(tbody.querySelector('[data-testid="coach-roster-jersey-input"]')).not.toBeNull();
  });

  it('Save click PATCHes the changed value and exits edit mode on success', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchStub = (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            entry: {
              id: 're_a',
              teamId: 't_one',
              athleteUserId: 'u',
              athleteEmail: 'a@test.invalid',
              athleteFullName: 'Ada Lovelace',
              jerseyNumber: '9',
              primaryPosition: 'Setter',
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    attachRowActions(tbody, 't_one', fetchStub);
    click(COACH_ROSTER_TEST_IDS.editBtn);
    const input = tbody.querySelector<HTMLInputElement>(
      '[data-testid="coach-roster-jersey-input"]',
    );
    if (!input) throw new Error('jersey input missing');
    input.value = '9';
    click(COACH_ROSTER_TEST_IDS.saveBtn);
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ jerseyNumber: '9' });
    expect(tbody.querySelector('[data-testid="coach-roster-jersey"]')?.textContent).toBe('9');
  });

  it('Save click surfaces the server error message inline on a 400', async () => {
    const fetchStub = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'jerseyNumber must be 1-3 digits' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    attachRowActions(tbody, 't_one', fetchStub);
    click(COACH_ROSTER_TEST_IDS.editBtn);
    const input = tbody.querySelector<HTMLInputElement>(
      '[data-testid="coach-roster-jersey-input"]',
    );
    if (!input) throw new Error('jersey input missing');
    input.value = 'abc';
    click(COACH_ROSTER_TEST_IDS.saveBtn);
    await flush();

    const slot = tbody.querySelector<HTMLElement>('[data-testid="coach-roster-row-error"]');
    expect(slot?.hidden).toBe(false);
    expect(slot?.textContent).toBe('jerseyNumber must be 1-3 digits');
  });

  it('Cancel click restores the read-only cells without a fetch', () => {
    const fetchStub = (async () => {
      throw new Error('fetch must not be called on cancel');
    }) as unknown as typeof fetch;
    attachRowActions(tbody, 't_one', fetchStub);
    click(COACH_ROSTER_TEST_IDS.editBtn);
    click(COACH_ROSTER_TEST_IDS.cancelBtn);
    expect(tbody.querySelector('[data-testid="coach-roster-jersey-input"]')).toBeNull();
    expect(tbody.querySelector('[data-testid="coach-roster-jersey"]')?.textContent).toBe('7');
  });

  it('Remove → confirm DELETEs the entry and removes the row on 204', async () => {
    const calls: Array<{ method: string }> = [];
    const fetchStub = (async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET' });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    attachRowActions(tbody, 't_one', fetchStub);
    click(COACH_ROSTER_TEST_IDS.removeBtn);
    // Confirm dialog is mounted on document.body.
    click(COACH_ROSTER_TEST_IDS.removeConfirmYes, document);
    await flush();

    expect(calls).toEqual([{ method: 'DELETE' }]);
    expect(tbody.querySelectorAll('tr')).toHaveLength(0);
  });

  it('Remove → cancel does not DELETE and keeps the row', async () => {
    const fetchStub = (async () => {
      throw new Error('fetch must not be called when remove is cancelled');
    }) as unknown as typeof fetch;

    attachRowActions(tbody, 't_one', fetchStub);
    click(COACH_ROSTER_TEST_IDS.removeBtn);
    click(COACH_ROSTER_TEST_IDS.removeConfirmCancel, document);
    await flush();

    expect(tbody.querySelectorAll('tr')).toHaveLength(1);
    expect(document.querySelector('dialog[data-testid="coach-roster-remove-confirm"]')).toBeNull();
  });
});
