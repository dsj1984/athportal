// apps/web/src/components/admin/InvitationList.ts
//
// Pure-TS helpers behind the org-admin pending-invitations table on
// `/admin/invitations`. The `.astro` sibling (`InvitationList.astro`)
// renders the table shell; its inline client `<script>` imports the
// row type and `formatInvitationTimestamp` so the "Sent" timestamp
// formatting stays under unit-tier control.
//
// Extracted from the inline script by Story #1088 to pin the
// epoch-milliseconds contract: `GET /api/v1/admin/invitations` returns
// `createdAt` already in epoch **milliseconds**, so it must NOT be
// re-scaled by 1000. The previous inline `new Date(ts * 1000)`
// projected every "Sent" value to the year ~58381.

export interface InvitationRow {
  readonly id: string;
  readonly email: string;
  readonly role: 'coach' | 'athlete';
  /** Epoch **milliseconds**, as returned by `GET /api/v1/admin/invitations`. */
  readonly createdAt: number;
}

/**
 * Format an invitation's `createdAt` into a local date/time label.
 *
 * `ts` is epoch **milliseconds** — the wire shape the admin invitations
 * API returns. It is passed straight to `new Date(...)` with no
 * re-scaling; multiplying by 1000 here is the Story #1088 bug that
 * pushed the rendered "Sent" date to the year ~58381.
 */
export function formatInvitationTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}
