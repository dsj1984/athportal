// apps/web/src/components/coach/InviteAthleteDialog.ts
//
// Pure-TS view-shape, render, and behaviour helpers for the coach
// "invite athlete" dialog and the pending-invites strip (Epic #11 /
// Story #920 / Task #923).
//
// Why pure-TS rather than a React island? The coach surface in
// `@repo/web` does not wire `@astrojs/react`; the Story #912 precedent
// (see `./RosterTable.ts` for the locked-in pattern) pairs an
// `.astro` shell with a sibling `.ts` module and binds them via an
// inline `<script>` on the parent page. The Task #923 AC wording
// ("InviteAthleteDialog.tsx") reflects the planning shorthand for the
// component; the ACs themselves are behavioural — open the dialog,
// submit the form, refresh the strip on success, render one row per
// pending invite with a revoke button — which this module satisfies
// while preserving the repo's existing composition pattern.
//
// Security-baseline.md (Output & Rendering): every cell value lands
// via `textContent`. No `innerHTML` anywhere — a coach-supplied or
// server-supplied string with markup is rendered as visible text.

/**
 * Canonical `data-testid` values exposed by the coach invite dialog
 * and pending-invites strip. Locked by Task #923 ACs so acceptance
 * scenarios target stable selectors across re-renders. A change here
 * is a breaking change to the acceptance suite — bump together.
 */
export const COACH_INVITE_TEST_IDS = {
  openBtn: 'coach-invite-open-btn',
  dialog: 'coach-invite-dialog',
  emailInput: 'coach-invite-email-input',
  firstNameInput: 'coach-invite-first-name-input',
  lastNameInput: 'coach-invite-last-name-input',
  submitBtn: 'coach-invite-submit-btn',
  cancelBtn: 'coach-invite-cancel-btn',
  error: 'coach-invite-error',
  strip: 'coach-pending-invites-strip',
  stripEmpty: 'coach-pending-invites-empty',
  row: 'coach-pending-invite-row',
  revokeBtn: 'coach-pending-invite-revoke-btn',
  resendBtn: 'coach-pending-invite-resend-btn',
  expiredPill: 'coach-pending-invite-expired-pill',
} as const;

/**
 * Wire-shape of one `roster_invite` row as returned by the coach
 * invites endpoints. Mirrors `RosterInviteOutput` from
 * `@repo/shared/schemas/coach/roster` — declared locally so the
 * client render is decoupled from the Zod runtime parse.
 */
export interface CoachInviteEntry {
  readonly id: string;
  readonly teamId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  readonly expiresAt: string;
  readonly createdAt: string;
}

/**
 * Build the API URL for the team's roster-invites list / create
 * endpoint. Centralised so the page's inline `<script>` and the unit
 * tests share one definition.
 */
export function buildInvitesUrl(teamId: string): string {
  return `/api/v1/coach/teams/${encodeURIComponent(teamId)}/roster/invites`;
}

/**
 * Build the API URL for a specific invite revoke action.
 */
export function buildRevokeUrl(teamId: string, inviteId: string): string {
  return `/api/v1/coach/teams/${encodeURIComponent(teamId)}/roster/invites/${encodeURIComponent(
    inviteId,
  )}/revoke`;
}

/**
 * Statuses the pending-invites strip surfaces to the coach (Story
 * #1051 / F34). `pending` invites are live work; `expired` invites are
 * stale work the coach can re-send. `declined` and `revoked` stay
 * hidden — surfacing a final "no" with no next action is noise.
 */
const VISIBLE_INVITE_STATUSES: ReadonlySet<CoachInviteEntry['status']> = new Set([
  'pending',
  'expired',
]);

/**
 * Filter the raw invites list down to the rows the strip renders:
 * `pending` and `expired` only. The list-invites API returns every
 * status (no server-side filter), so the strip narrows client-side —
 * the same narrowing also drives the empty-state toggle, so a strip
 * with only declined/revoked invites still reads as empty.
 */
export function filterVisibleInvites(items: ReadonlyArray<CoachInviteEntry>): CoachInviteEntry[] {
  return items.filter((i) => VISIBLE_INVITE_STATUSES.has(i.status));
}

/**
 * True when the invite should render in the strip's expired visual
 * state. The server transitions `status` lazily, so a row whose
 * `expires_at < now()` may still arrive as `status === 'pending'` —
 * treat both the explicit `expired` status and a lapsed lifetime as
 * expired so the pill and the Re-send CTA stay consistent with the
 * "expired" meta label `formatExpiresLabel` already renders.
 */
export function isInviteExpired(entry: CoachInviteEntry, now: Date = new Date()): boolean {
  if (entry.status === 'expired') return true;
  const exp = new Date(entry.expiresAt);
  if (Number.isNaN(exp.getTime())) return false;
  return exp.getTime() - now.getTime() <= 0;
}

/**
 * Format a `RosterInviteOutput.expiresAt` ISO string into a short
 * "expires in N days" label for the strip. Returns "expired" when the
 * value is in the past — the server transitions `status` lazily, so a
 * row whose `expires_at < now()` may still arrive with
 * `status === 'pending'`.
 */
export function formatExpiresLabel(expiresAt: string, now: Date = new Date()): string {
  const exp = new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return '—';
  const ms = exp.getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days === 1) return 'expires in 1 day';
  return `expires in ${days} days`;
}

/**
 * Compose a "display name" for a pending invite row. Falls back to
 * the email when neither first nor last name is set. Trims and joins
 * the two name fields with a single space.
 */
export function inviteDisplayName(entry: CoachInviteEntry): string {
  const first = entry.firstName?.trim() ?? '';
  const last = entry.lastName?.trim() ?? '';
  const joined = [first, last].filter((s) => s.length > 0).join(' ');
  return joined.length > 0 ? joined : entry.email;
}

/**
 * Render the pending-invites strip body. The function fully replaces
 * the supplied container's children. Each row carries the canonical
 * row data-testid keyed by `data-invite-id`. Cells are populated via
 * `textContent`.
 *
 * Rows render in one of two states (Story #1051 / F34):
 *   - **pending** — the name + "expires in N days" meta and a per-row
 *     **Revoke** button.
 *   - **expired** — a distinct "Expired" pill alongside the name, the
 *     "expired" meta label, and a **Re-send** button that the page's
 *     inline `script` wires to the create-invite endpoint for the same
 *     email (`data-invite-email`).
 *
 * The container is a `<ul>` so the rendered list is semantically a
 * list of invitations (screen-readers announce the count). The
 * empty-state row stays in place — the function does NOT touch the
 * seeded empty placeholder; the caller toggles it via the `hidden`
 * attribute based on `items.length`.
 */
export function renderPendingInvites(
  container: HTMLElement,
  items: ReadonlyArray<CoachInviteEntry>,
  now: Date = new Date(),
): void {
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const item of items) {
    const expired = isInviteExpired(item, now);

    const li = document.createElement('li');
    li.setAttribute('data-testid', COACH_INVITE_TEST_IDS.row);
    li.setAttribute('data-invite-id', item.id);
    li.setAttribute('data-status', expired ? 'expired' : 'pending');
    li.className =
      'flex items-center justify-between gap-3 rounded-md border border-border bg-surface-card px-3 py-2 text-sm';

    const left = document.createElement('div');
    left.className = 'flex flex-col';

    const nameRow = document.createElement('div');
    nameRow.className = 'flex items-center gap-2';

    const nameEl = document.createElement('span');
    nameEl.className = 'font-medium text-text-primary';
    nameEl.setAttribute('data-col', 'name');
    nameEl.textContent = inviteDisplayName(item);
    nameRow.appendChild(nameEl);

    if (expired) {
      const pill = document.createElement('span');
      pill.setAttribute('data-testid', COACH_INVITE_TEST_IDS.expiredPill);
      pill.className =
        'inline-flex items-center rounded-full border border-action-coral px-2 py-0.5 text-xs font-medium text-action-coral';
      pill.textContent = 'Expired';
      nameRow.appendChild(pill);
    }

    left.appendChild(nameRow);

    const metaEl = document.createElement('span');
    metaEl.className = 'text-xs text-text-secondary';
    metaEl.setAttribute('data-col', 'meta');
    metaEl.textContent = `${item.email} · ${formatExpiresLabel(item.expiresAt, now)}`;
    left.appendChild(metaEl);

    li.appendChild(left);

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className =
      'inline-flex items-center justify-center rounded-md border border-border bg-surface-card px-2.5 py-1.5 text-xs font-medium text-text-primary shadow-sm hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
    if (expired) {
      actionBtn.setAttribute('data-testid', COACH_INVITE_TEST_IDS.resendBtn);
      actionBtn.setAttribute('data-invite-id', item.id);
      actionBtn.setAttribute('data-invite-email', item.email);
      actionBtn.textContent = 'Re-send';
    } else {
      actionBtn.setAttribute('data-testid', COACH_INVITE_TEST_IDS.revokeBtn);
      actionBtn.setAttribute('data-invite-id', item.id);
      actionBtn.textContent = 'Revoke';
    }
    li.appendChild(actionBtn);

    container.appendChild(li);
  }
}

/**
 * Shape of the dialog's submit payload as sent to the API. Mirrors
 * the `InviteAthleteInput` Zod schema in `@repo/shared/schemas/coach/
 * roster` — declared locally so the client form keeps the wire-shape
 * pinned without the runtime parse dependency.
 */
export interface InviteAthletePayload {
  readonly email: string;
  readonly firstName?: string;
  readonly lastName?: string;
}

/**
 * Read the dialog form into an `InviteAthletePayload`. Trims string
 * values and drops blank optional fields so the wire body never
 * carries an empty-string `firstName` (which the server's Zod
 * `.min(1)` would reject).
 *
 * Returns `null` when `email` is blank — the caller surfaces a
 * client-side error before issuing the network request, but server-
 * side validation remains the authoritative check
 * (security-baseline.md §Input Validation).
 */
export function readInvitePayload(form: HTMLFormElement): InviteAthletePayload | null {
  const data = new FormData(form);
  // FormData.get returns `FormDataEntryValue | null` (i.e. `string | File | null`).
  // The invite form only carries text inputs, but the typesystem doesn't know
  // that — coerce explicitly so a File never round-trips through `.toString()`
  // as the literal `[object Object]` (eslint no-base-to-string).
  const asString = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
  const email = asString(data.get('email')).trim();
  if (email.length === 0) return null;
  const firstNameRaw = asString(data.get('firstName')).trim();
  const lastNameRaw = asString(data.get('lastName')).trim();
  const payload: InviteAthletePayload = {
    email,
    ...(firstNameRaw.length > 0 ? { firstName: firstNameRaw } : {}),
    ...(lastNameRaw.length > 0 ? { lastName: lastNameRaw } : {}),
  };
  return payload;
}
