// apps/web/src/components/coach/RosterTable.ts
//
// Pure-TS view-shape and rendering helpers for the coach roster page
// (Epic #11 / Story #912 / Task #918, Story #917 / Task #928). The
// `.astro` sibling (`./RosterTable.astro`) renders the empty shell
// composed of the `apps/web/src/components/ui/*` primitives (Btn);
// the inline `<script>` on the parent page binds to it via
// `data-testid` and calls `fetchRoster` + `renderRosterRows` to
// populate the table on load.
//
// Why pure-TS rather than a React island? `@repo/web` does not wire
// `@astrojs/react` for the coach surface; every existing admin
// component pairs an `.astro` renderer with a sibling `.ts` module
// (see `apps/web/src/components/admin/roster/RosterTable.ts` for the
// load-bearing precedent — Story #661 / Task #693). Standing up the
// full React island toolchain is foundation-level scope that belongs
// to its own infrastructure Story, not this Story.
//
// Story #917 / Task #928 layered inline edit + remove on top of the
// existing render path. The mutation handlers (PATCH + DELETE) live
// in the same module so the page-level `<script>` is one import.
// `attachRowActions` wires per-row click handlers; `enterEditMode`
// swaps the jersey/position cells for inputs and reveals save/cancel
// controls; `exitEditMode` restores the read-only view. The
// soft-warning surface (`coach-roster-jersey-warning`) renders in a
// dedicated `<td>` slot, hidden until the PATCH response sets it.

/**
 * Canonical `data-testid` values exposed by the coach roster surface.
 * Locked by Task #918 ACs (read path) and Task #928 (mutation path)
 * so acceptance scenarios target stable selectors across re-renders.
 * Any change to a string here is a breaking change to the acceptance
 * suite — bump the two in the same PR.
 *
 * Task #928 invariance: every surviving Task #918 id (`root`, `row`,
 * `jersey`, `position`, `emptyState`, `error`) carries the same string
 * it had at Task #918 close. New ids added in Task #928 are clearly
 * grouped below the original block.
 *
 * Story #1049 (F28 cleanup) dropped the `badge` id together with the
 * verification-badge "Status" column it labelled — the column only
 * re-rendered the primary position and there is no verification state
 * to show yet. <!-- Re-introduced by Epic #14 -->
 */
export const COACH_ROSTER_TEST_IDS = {
  root: 'coach-roster-root',
  row: 'coach-roster-row',
  jersey: 'coach-roster-jersey',
  position: 'coach-roster-position',
  emptyState: 'coach-roster-empty',
  error: 'coach-roster-error',
  nameLink: 'coach-roster-name-link',
  // Task #928 — mutation surface
  editBtn: 'coach-roster-edit-btn',
  saveBtn: 'coach-roster-save-btn',
  cancelBtn: 'coach-roster-cancel-btn',
  removeBtn: 'coach-roster-remove-btn',
  jerseyInput: 'coach-roster-jersey-input',
  positionInput: 'coach-roster-position-input',
  jerseyWarning: 'coach-roster-jersey-warning',
  rowError: 'coach-roster-row-error',
  removeConfirm: 'coach-roster-remove-confirm',
  removeConfirmYes: 'coach-roster-remove-confirm-yes',
  removeConfirmCancel: 'coach-roster-remove-confirm-cancel',
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
 * Patch payload accepted by `PATCH /entries/:entryId`. Both fields
 * are independently optional; an empty patch is rejected server-side.
 * `null` clears the column.
 */
export interface CoachRosterEntryPatch {
  readonly jerseyNumber?: string | null;
  readonly primaryPosition?: string | null;
}

/**
 * Response envelope for `PATCH /entries/:entryId`. The `warnings`
 * block surfaces the soft-duplicate-jersey signal the server returns
 * when another active entry on the same team carries the same number.
 * Absent on a clean update.
 */
export interface PatchEnvelope {
  readonly success: boolean;
  readonly data?: {
    readonly entry: CoachRosterEntry;
    readonly warnings?: { readonly duplicateJerseyNumber?: boolean };
  };
  readonly error?: { readonly code?: string; readonly message?: string };
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
 * Build the API URL for one roster entry (used by PATCH and DELETE).
 * Both segments are URL-encoded so a teamId or entryId containing a
 * special character round-trips cleanly.
 */
export function buildEntryUrl(teamId: string, entryId: string): string {
  return `/api/v1/coach/teams/${encodeURIComponent(teamId)}/roster/entries/${encodeURIComponent(entryId)}`;
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
 * the row.
 *
 * Task #928 added an "actions" cell carrying the per-row Edit and
 * Remove controls. The edit controls (save/cancel) and the
 * jersey-warning slot are present in the DOM but hidden until
 * `enterEditMode` reveals them.
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
    tr.setAttribute('data-roster-team-id', item.teamId);

    const nameTd = document.createElement('td');
    nameTd.setAttribute('data-col', 'name');
    // Story #985 / F29 — the athlete name links to the team-scoped
    // athlete profile. `item.id` is the roster-entry id, which is
    // exactly the `:rosterEntryId` segment the profile route + API
    // expect (NOT the athlete's `users.id`). The name is set via
    // `textContent` on the anchor so a server-supplied value cannot
    // inject markup (per security-baseline § Output & Rendering).
    const nameLink = document.createElement('a');
    nameLink.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.nameLink);
    nameLink.href = `/app/coach/teams/${encodeURIComponent(item.teamId)}/athletes/${encodeURIComponent(item.id)}`;
    nameLink.textContent = item.athleteFullName;
    nameTd.appendChild(nameLink);
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

    // The verification-badge "Status" cell was dropped in Story #1049
    // (F28 cleanup) — it duplicated the primary position above with no
    // verification state to show. <!-- Re-introduced by Epic #14 -->

    // Actions cell — Edit + Remove controls + jersey-warning slot.
    // Edit reveals save/cancel; cancel restores the read-only cells.
    // The warning text lives in a sibling element that is hidden by
    // default and shown by the PATCH success handler when the server
    // returns `warnings.duplicateJerseyNumber: true`.
    const actionsTd = document.createElement('td');
    actionsTd.setAttribute('data-col', 'actions');
    actionsTd.appendChild(buildButton('button', COACH_ROSTER_TEST_IDS.editBtn, 'Edit'));
    actionsTd.appendChild(buildButton('button', COACH_ROSTER_TEST_IDS.removeBtn, 'Remove'));

    const saveBtn = buildButton('button', COACH_ROSTER_TEST_IDS.saveBtn, 'Save');
    saveBtn.hidden = true;
    actionsTd.appendChild(saveBtn);

    const cancelBtn = buildButton('button', COACH_ROSTER_TEST_IDS.cancelBtn, 'Cancel');
    cancelBtn.hidden = true;
    actionsTd.appendChild(cancelBtn);

    const warning = document.createElement('span');
    warning.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.jerseyWarning);
    warning.setAttribute('role', 'status');
    warning.hidden = true;
    actionsTd.appendChild(warning);

    // Inline per-row error slot. Surfaces the server's user-facing
    // `error.message` on a failed PATCH/DELETE (e.g. 400 INVALID_INPUT)
    // so the coach sees a single readable sentence on the row instead
    // of a raw envelope. Hidden until a mutation handler fills it.
    const rowError = document.createElement('span');
    rowError.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.rowError);
    rowError.setAttribute('role', 'alert');
    rowError.hidden = true;
    actionsTd.appendChild(rowError);

    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  }
}

function buildButton(type: 'button', testId: string, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = type;
  btn.setAttribute('data-testid', testId);
  btn.textContent = label;
  // Visual chrome (border, padding, focus ring) is applied at the
  // page level by a stylesheet that targets `[data-testid^="coach-roster-"]`
  // selectors; keeping it out of this module preserves the pure-TS
  // posture of the existing render path.
  return btn;
}

/**
 * Find the row's per-column cell. Centralised so future renames of
 * the `data-col` markers happen once.
 */
function rowCell(
  tr: HTMLTableRowElement,
  col: 'jersey' | 'position' | 'actions',
): HTMLElement | null {
  return tr.querySelector<HTMLElement>(`td[data-col="${col}"]`);
}

/**
 * Find a button inside an action cell by its testid.
 */
function actionButton(tr: HTMLTableRowElement, testId: string): HTMLButtonElement | null {
  return tr.querySelector<HTMLButtonElement>(`button[data-testid="${testId}"]`);
}

/**
 * Swap the read-only jersey / position cells for `<input>` fields and
 * reveal the save/cancel buttons. The original textContent values are
 * cached on the cells via `data-original` so `exitEditMode` can
 * restore them on cancel without re-fetching the row.
 *
 * Stashes the input elements via `tr.querySelector` lookups in
 * downstream calls — `data-testid` attributes are the canonical handle.
 */
export function enterEditMode(tr: HTMLTableRowElement): void {
  const jerseyTd = rowCell(tr, 'jersey');
  const positionTd = rowCell(tr, 'position');
  if (!jerseyTd || !positionTd) return;

  const originalJersey = jerseyTd.textContent ?? '';
  const originalPosition = positionTd.textContent ?? '';
  jerseyTd.setAttribute('data-original', originalJersey);
  positionTd.setAttribute('data-original', originalPosition);

  jerseyTd.textContent = '';
  const jerseyInput = document.createElement('input');
  jerseyInput.type = 'text';
  jerseyInput.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.jerseyInput);
  jerseyInput.setAttribute('inputmode', 'numeric');
  jerseyInput.setAttribute('aria-label', 'Jersey number');
  jerseyInput.maxLength = 3;
  jerseyInput.value = originalJersey === '—' ? '' : originalJersey;
  jerseyTd.appendChild(jerseyInput);

  positionTd.textContent = '';
  const positionInput = document.createElement('input');
  positionInput.type = 'text';
  positionInput.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.positionInput);
  positionInput.setAttribute('aria-label', 'Primary position');
  positionInput.maxLength = 32;
  positionInput.value = originalPosition === '—' ? '' : originalPosition;
  positionTd.appendChild(positionInput);

  const editBtn = actionButton(tr, COACH_ROSTER_TEST_IDS.editBtn);
  const removeBtn = actionButton(tr, COACH_ROSTER_TEST_IDS.removeBtn);
  const saveBtn = actionButton(tr, COACH_ROSTER_TEST_IDS.saveBtn);
  const cancelBtn = actionButton(tr, COACH_ROSTER_TEST_IDS.cancelBtn);
  if (editBtn) editBtn.hidden = true;
  if (removeBtn) removeBtn.hidden = true;
  if (saveBtn) saveBtn.hidden = false;
  if (cancelBtn) cancelBtn.hidden = false;

  // A pending edit clears any prior warning — a stale "duplicate
  // jersey" message from the last save would be confusing while the
  // coach is mid-edit.
  hideJerseyWarning(tr);
}

/**
 * Restore the read-only jersey / position cells. When `updated` is
 * provided, the cells reflect the new server-returned values; on
 * cancel (no `updated`), the cached `data-original` strings are
 * restored verbatim.
 */
export function exitEditMode(
  tr: HTMLTableRowElement,
  updated?: { jerseyNumber: string | null; primaryPosition: string | null },
): void {
  const jerseyTd = rowCell(tr, 'jersey');
  const positionTd = rowCell(tr, 'position');
  if (!jerseyTd || !positionTd) return;

  const jerseyValue = updated
    ? (updated.jerseyNumber ?? '—')
    : (jerseyTd.getAttribute('data-original') ?? '—');
  const positionValue = updated
    ? (updated.primaryPosition ?? '—')
    : (positionTd.getAttribute('data-original') ?? '—');

  while (jerseyTd.firstChild) jerseyTd.removeChild(jerseyTd.firstChild);
  jerseyTd.textContent = jerseyValue;
  jerseyTd.removeAttribute('data-original');

  while (positionTd.firstChild) positionTd.removeChild(positionTd.firstChild);
  positionTd.textContent = positionValue;
  positionTd.removeAttribute('data-original');

  const editBtn = actionButton(tr, COACH_ROSTER_TEST_IDS.editBtn);
  const removeBtn = actionButton(tr, COACH_ROSTER_TEST_IDS.removeBtn);
  const saveBtn = actionButton(tr, COACH_ROSTER_TEST_IDS.saveBtn);
  const cancelBtn = actionButton(tr, COACH_ROSTER_TEST_IDS.cancelBtn);
  if (editBtn) editBtn.hidden = false;
  if (removeBtn) removeBtn.hidden = false;
  if (saveBtn) saveBtn.hidden = true;
  if (cancelBtn) cancelBtn.hidden = true;
}

/**
 * Show the duplicate-jersey warning on the supplied row. The warning
 * slot is a `<span data-testid="coach-roster-jersey-warning">` seeded
 * during `renderRosterRows` so callers do not allocate elements at
 * mutation time.
 *
 * Copy aligns with `docs/style-guide.md` (sentence-case advisory tone
 * — warning, not error — the save still succeeded).
 */
export function showJerseyWarning(tr: HTMLTableRowElement, jerseyNumber: string): void {
  const slot = tr.querySelector<HTMLElement>(
    `[data-testid="${COACH_ROSTER_TEST_IDS.jerseyWarning}"]`,
  );
  if (!slot) return;
  slot.textContent = `Heads up: another athlete on this team is also using #${jerseyNumber}.`;
  slot.hidden = false;
}

/**
 * Hide the duplicate-jersey warning on the supplied row. Called when
 * the coach re-enters edit mode or on a clean PATCH response.
 */
export function hideJerseyWarning(tr: HTMLTableRowElement): void {
  const slot = tr.querySelector<HTMLElement>(
    `[data-testid="${COACH_ROSTER_TEST_IDS.jerseyWarning}"]`,
  );
  if (!slot) return;
  slot.hidden = true;
  slot.textContent = '';
}

/**
 * Read the current jersey + position values from a row in edit mode.
 * Returns `null` for an empty string, which the server interprets as
 * "clear the column" (the Zod schema accepts `null` for both fields).
 */
export function readEditValues(tr: HTMLTableRowElement): {
  jerseyNumber: string | null;
  primaryPosition: string | null;
} {
  const jerseyInput = tr.querySelector<HTMLInputElement>(
    `input[data-testid="${COACH_ROSTER_TEST_IDS.jerseyInput}"]`,
  );
  const positionInput = tr.querySelector<HTMLInputElement>(
    `input[data-testid="${COACH_ROSTER_TEST_IDS.positionInput}"]`,
  );
  const jerseyRaw = jerseyInput?.value.trim() ?? '';
  const positionRaw = positionInput?.value.trim() ?? '';
  return {
    jerseyNumber: jerseyRaw === '' ? null : jerseyRaw,
    primaryPosition: positionRaw === '' ? null : positionRaw,
  };
}

/**
 * Compute the minimal patch payload for the PATCH request. Only the
 * fields that actually changed from the cached `data-original` are
 * included so a no-op save doesn't tickle the server's duplicate
 * jersey probe needlessly.
 *
 * Returns `null` when nothing changed — the caller treats this as
 * "exit edit mode with no fetch", which is the cheapest path.
 */
export function buildPatchPayload(
  tr: HTMLTableRowElement,
  values: { jerseyNumber: string | null; primaryPosition: string | null },
): CoachRosterEntryPatch | null {
  const jerseyTd = rowCell(tr, 'jersey');
  const positionTd = rowCell(tr, 'position');
  const originalJerseyRaw = jerseyTd?.getAttribute('data-original') ?? '';
  const originalPositionRaw = positionTd?.getAttribute('data-original') ?? '';
  const originalJersey = originalJerseyRaw === '—' ? null : originalJerseyRaw;
  const originalPosition = originalPositionRaw === '—' ? null : originalPositionRaw;

  const patch: { jerseyNumber?: string | null; primaryPosition?: string | null } = {};
  if (values.jerseyNumber !== originalJersey) {
    patch.jerseyNumber = values.jerseyNumber;
  }
  if (values.primaryPosition !== originalPosition) {
    patch.primaryPosition = values.primaryPosition;
  }
  if (Object.keys(patch).length === 0) return null;
  return patch;
}

/**
 * Remove a row from the table. Used by the DELETE handler after a 204
 * response — keeps the DOM in sync with the persisted state without
 * a full re-fetch.
 */
export function removeRow(tr: HTMLTableRowElement): void {
  tr.remove();
}

/**
 * Show the inline per-row error message. Used by the mutation handlers
 * when a PATCH/DELETE fails — the server's user-facing `error.message`
 * is rendered verbatim (it is a single readable sentence since the API
 * picks `issues[0].message`), never the raw envelope.
 */
export function showRowError(tr: HTMLTableRowElement, message: string): void {
  const slot = tr.querySelector<HTMLElement>(`[data-testid="${COACH_ROSTER_TEST_IDS.rowError}"]`);
  if (!slot) return;
  slot.textContent = message;
  slot.hidden = false;
}

/**
 * Hide the inline per-row error message. Called when the coach starts a
 * fresh edit or a retry succeeds.
 */
export function hideRowError(tr: HTMLTableRowElement): void {
  const slot = tr.querySelector<HTMLElement>(`[data-testid="${COACH_ROSTER_TEST_IDS.rowError}"]`);
  if (!slot) return;
  slot.hidden = true;
  slot.textContent = '';
}

/**
 * Read the athlete's display name from the row's name cell. Used to
 * personalise the remove-confirmation prompt.
 */
function rowAthleteName(tr: HTMLTableRowElement): string {
  const nameTd = tr.querySelector<HTMLElement>('td[data-col="name"]');
  const name = nameTd?.textContent?.trim();
  return name && name.length > 0 ? name : 'this athlete';
}

/**
 * Mount the remove-confirmation dialog into `document.body` and return
 * it. The dialog carries the canonical confirm/cancel testids so the
 * acceptance suite can target them. Any previously-mounted instance is
 * removed first so repeated Remove clicks never stack duplicates.
 */
export function mountRemoveConfirm(athleteName: string): HTMLDialogElement {
  const existing = document.querySelector<HTMLDialogElement>(
    `dialog[data-testid="${COACH_ROSTER_TEST_IDS.removeConfirm}"]`,
  );
  if (existing) existing.remove();

  const dialog = document.createElement('dialog');
  dialog.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.removeConfirm);

  const prompt = document.createElement('p');
  prompt.textContent = `Remove ${athleteName} from this roster?`;
  dialog.appendChild(prompt);

  dialog.appendChild(buildButton('button', COACH_ROSTER_TEST_IDS.removeConfirmCancel, 'Cancel'));
  dialog.appendChild(buildButton('button', COACH_ROSTER_TEST_IDS.removeConfirmYes, 'Remove'));

  document.body.appendChild(dialog);
  return dialog;
}

/**
 * Open the remove-confirmation dialog and resolve to the coach's
 * choice. Resolves `true` on confirm, `false` on cancel. The dialog is
 * removed from the DOM either way. `showModal` is used when available
 * (real browsers) and falls back to the `open` attribute under jsdom,
 * which does not implement modal dialogs.
 */
function openRemoveConfirm(athleteName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = mountRemoveConfirm(athleteName);
    const yes = dialog.querySelector<HTMLButtonElement>(
      `button[data-testid="${COACH_ROSTER_TEST_IDS.removeConfirmYes}"]`,
    );
    const cancel = dialog.querySelector<HTMLButtonElement>(
      `button[data-testid="${COACH_ROSTER_TEST_IDS.removeConfirmCancel}"]`,
    );
    const settle = (result: boolean): void => {
      dialog.remove();
      resolve(result);
    };
    yes?.addEventListener('click', () => settle(true));
    cancel?.addEventListener('click', () => settle(false));
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
  });
}

/**
 * Persist a row's pending edit. Computes the minimal patch, PATCHes it,
 * and reconciles the DOM with the server's response: on success the row
 * exits edit mode with the returned values and surfaces the soft
 * duplicate-jersey warning when present; on a 4xx the server's
 * `error.message` is rendered inline on the row.
 */
async function saveRow(
  tr: HTMLTableRowElement,
  teamId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const entryId = tr.getAttribute('data-roster-entry-id');
  if (!entryId) return;

  const values = readEditValues(tr);
  const patch = buildPatchPayload(tr, values);
  if (patch === null) {
    // No change — cheapest path is to leave edit mode without a fetch.
    exitEditMode(tr);
    return;
  }

  hideRowError(tr);
  try {
    const res = await fetchImpl(buildEntryUrl(teamId, entryId), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(patch),
    });
    const envelope = (await res.json().catch(() => null)) as PatchEnvelope | null;
    if (!res.ok || envelope?.success !== true || !envelope.data) {
      showRowError(tr, envelope?.error?.message ?? 'Could not save changes.');
      return;
    }
    const entry = envelope.data.entry;
    exitEditMode(tr, {
      jerseyNumber: entry.jerseyNumber,
      primaryPosition: entry.primaryPosition,
    });
    if (envelope.data.warnings?.duplicateJerseyNumber && entry.jerseyNumber) {
      showJerseyWarning(tr, entry.jerseyNumber);
    } else {
      hideJerseyWarning(tr);
    }
  } catch {
    showRowError(tr, 'Could not reach the server.');
  }
}

/**
 * Confirm and remove a row. Opens the confirmation dialog; on confirm,
 * DELETEs the entry and removes the row on a 204. A failed DELETE
 * surfaces an inline row error.
 */
async function confirmAndRemove(
  tr: HTMLTableRowElement,
  teamId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const confirmed = await openRemoveConfirm(rowAthleteName(tr));
  if (!confirmed) return;

  const entryId = tr.getAttribute('data-roster-entry-id');
  if (!entryId) return;

  hideRowError(tr);
  try {
    const res = await fetchImpl(buildEntryUrl(teamId, entryId), {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    });
    if (res.status !== 204 && !res.ok) {
      const envelope = (await res.json().catch(() => null)) as PatchEnvelope | null;
      showRowError(tr, envelope?.error?.message ?? 'Could not remove the athlete.');
      return;
    }
    removeRow(tr);
  } catch {
    showRowError(tr, 'Could not reach the server.');
  }
}

/**
 * Wire per-row Edit / Save / Cancel / Remove handlers via a single
 * delegated click listener on the `<tbody>`. Delegation means rows
 * rendered after `renderRosterRows` re-runs pick up the handlers
 * without re-attaching — attach once per page load.
 *
 * `fetchImpl` is injectable so unit tests can drive the PATCH/DELETE
 * branches deterministically; production passes the global `fetch`.
 */
export function attachRowActions(
  tbody: HTMLTableSectionElement,
  teamId: string,
  fetchImpl: typeof fetch = fetch,
): void {
  tbody.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const tr = target.closest<HTMLTableRowElement>(
      `tr[data-testid="${COACH_ROSTER_TEST_IDS.row}"]`,
    );
    if (!tr) return;

    if (target.closest(`button[data-testid="${COACH_ROSTER_TEST_IDS.editBtn}"]`)) {
      hideRowError(tr);
      enterEditMode(tr);
      return;
    }
    if (target.closest(`button[data-testid="${COACH_ROSTER_TEST_IDS.cancelBtn}"]`)) {
      exitEditMode(tr);
      hideRowError(tr);
      return;
    }
    if (target.closest(`button[data-testid="${COACH_ROSTER_TEST_IDS.saveBtn}"]`)) {
      void saveRow(tr, teamId, fetchImpl);
      return;
    }
    if (target.closest(`button[data-testid="${COACH_ROSTER_TEST_IDS.removeBtn}"]`)) {
      void confirmAndRemove(tr, teamId, fetchImpl);
    }
  });
}
