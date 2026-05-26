// apps/web/src/components/coach/RosterTable.ts
//
// Pure-TS view-shape and rendering helpers for the coach roster page
// (Epic #11 / Story #912 / Task #918, Story #917 / Task #928). The
// `.astro` sibling (`./RosterTable.astro`) renders the empty shell
// composed of the `apps/web/src/components/ui/*` primitives (Badge,
// Btn); the inline `<script>` on the parent page binds to it via
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
 * Task #928 invariance: every Task #918 id (`root`, `row`, `jersey`,
 * `position`, `badge`, `emptyState`, `error`) carries the same string
 * it had at Task #918 close. New ids added in Task #928 are clearly
 * grouped below the original block.
 */
export const COACH_ROSTER_TEST_IDS = {
  root: 'coach-roster-root',
  row: 'coach-roster-row',
  jersey: 'coach-roster-jersey',
  position: 'coach-roster-position',
  badge: 'coach-roster-badge',
  emptyState: 'coach-roster-empty',
  error: 'coach-roster-error',
  // Task #928 — mutation surface
  editBtn: 'coach-roster-edit-btn',
  saveBtn: 'coach-roster-save-btn',
  cancelBtn: 'coach-roster-cancel-btn',
  removeBtn: 'coach-roster-remove-btn',
  jerseyInput: 'coach-roster-jersey-input',
  positionInput: 'coach-roster-position-input',
  jerseyWarning: 'coach-roster-jersey-warning',
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
 * the row. The badge cell carries the `coach-roster-badge` testid
 * whether or not the row has a jersey — it always renders the
 * primary-position chip when present, otherwise an em-dash placeholder.
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
    nameTd.textContent = item.athleteFullName;
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

    const badgeTd = document.createElement('td');
    badgeTd.setAttribute('data-col', 'badge');
    badgeTd.setAttribute('data-testid', COACH_ROSTER_TEST_IDS.badge);
    // The badge cell carries the same primary-position string; the
    // visual chrome (rounded pill, soft-translucent tone) comes from
    // the `.astro` renderer's seeded `<span>` markup, which this
    // helper does NOT redraw — it only sets the textContent.
    badgeTd.textContent = item.primaryPosition ?? '—';
    tr.appendChild(badgeTd);

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

    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  }
}

function buildButton(
  type: 'button',
  testId: string,
  label: string,
): HTMLButtonElement {
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
function rowCell(tr: HTMLTableRowElement, col: 'jersey' | 'position' | 'actions'): HTMLElement | null {
  return tr.querySelector<HTMLElement>(`td[data-col="${col}"]`);
}

/**
 * Find a button inside an action cell by its testid.
 */
function actionButton(
  tr: HTMLTableRowElement,
  testId: string,
): HTMLButtonElement | null {
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
  const badgeTd = tr.querySelector<HTMLElement>(`td[data-testid="${COACH_ROSTER_TEST_IDS.badge}"]`);
  if (!jerseyTd || !positionTd) return;

  const jerseyValue = updated
    ? updated.jerseyNumber ?? '—'
    : jerseyTd.getAttribute('data-original') ?? '—';
  const positionValue = updated
    ? updated.primaryPosition ?? '—'
    : positionTd.getAttribute('data-original') ?? '—';

  while (jerseyTd.firstChild) jerseyTd.removeChild(jerseyTd.firstChild);
  jerseyTd.textContent = jerseyValue;
  jerseyTd.removeAttribute('data-original');

  while (positionTd.firstChild) positionTd.removeChild(positionTd.firstChild);
  positionTd.textContent = positionValue;
  positionTd.removeAttribute('data-original');

  if (badgeTd && updated) {
    badgeTd.textContent = positionValue;
  }

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
