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
 * row data-testid and a per-row revoke button keyed by
 * `data-invite-id`. Cells are populated via `textContent`.
 *
 * The container is a `<ul>` so the rendered list is semantically a
 * list of pending invitations (screen-readers announce the count).
 * The empty-state row stays in place — the function does NOT touch
 * the seeded empty placeholder; the caller toggles it via the
 * `hidden` attribute based on `items.length`.
 */
export function renderPendingInvites(
  container: HTMLElement,
  items: ReadonlyArray<CoachInviteEntry>,
  now: Date = new Date(),
): void {
  while (container.firstChild) container.removeChild(container.firstChild);
  for (const item of items) {
    const li = document.createElement('li');
    li.setAttribute('data-testid', COACH_INVITE_TEST_IDS.row);
    li.setAttribute('data-invite-id', item.id);
    li.className =
      'flex items-center justify-between gap-3 rounded-md border border-border bg-surface-card px-3 py-2 text-sm';

    const left = document.createElement('div');
    left.className = 'flex flex-col';

    const nameEl = document.createElement('span');
    nameEl.className = 'font-medium text-text-primary';
    nameEl.setAttribute('data-col', 'name');
    nameEl.textContent = inviteDisplayName(item);
    left.appendChild(nameEl);

    const metaEl = document.createElement('span');
    metaEl.className = 'text-xs text-text-secondary';
    metaEl.setAttribute('data-col', 'meta');
    metaEl.textContent = `${item.email} · ${formatExpiresLabel(item.expiresAt, now)}`;
    left.appendChild(metaEl);

    li.appendChild(left);

    const revokeBtn = document.createElement('button');
    revokeBtn.type = 'button';
    revokeBtn.setAttribute('data-testid', COACH_INVITE_TEST_IDS.revokeBtn);
    revokeBtn.setAttribute('data-invite-id', item.id);
    revokeBtn.className =
      'inline-flex items-center justify-center rounded-md border border-border bg-surface-card px-2.5 py-1.5 text-xs font-medium text-text-primary shadow-sm hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
    revokeBtn.textContent = 'Revoke';
    li.appendChild(revokeBtn);

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
  const email = (data.get('email') ?? '').toString().trim();
  if (email.length === 0) return null;
  const firstNameRaw = (data.get('firstName') ?? '').toString().trim();
  const lastNameRaw = (data.get('lastName') ?? '').toString().trim();
  const payload: InviteAthletePayload = {
    email,
    ...(firstNameRaw.length > 0 ? { firstName: firstNameRaw } : {}),
    ...(lastNameRaw.length > 0 ? { lastName: lastNameRaw } : {}),
  };
  return payload;
}
