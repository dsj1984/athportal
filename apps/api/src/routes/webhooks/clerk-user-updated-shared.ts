// apps/api/src/routes/webhooks/clerk-user-updated-shared.ts
//
// Shared types and event-shape narrowing for the Clerk `user.updated`
// webhook handler (Story #1054 / F33). Extracted so the contract test can
// import the same `VerifyWebhook` shape and `isUserUpdatedEvent` narrower
// as the handler, without dragging the runtime route module (and its
// dynamic `@clerk/backend/webhooks` import) into the test bundle.
//
// Sibling of `clerk-invitation-shared.ts` — same pattern, different event.

/**
 * Minimal shape of the verifier the handler depends on. Matches the
 * signature exported by `@clerk/backend/webhooks#verifyWebhook` but keeps
 * the test bundle free of that import — the test seam fakes the verifier
 * directly via `c.set('verifyWebhook', fake)`.
 */
export type VerifyWebhook = (
  request: Request,
  options: { signingSecret: string },
) => Promise<unknown>;

/**
 * Narrowed shape of the `user.updated` event we consume. The raw Clerk
 * payload carries the profile name in snake_case (`first_name` /
 * `last_name`) and the Clerk user id (our `clerk_subject_id`) on
 * `data.id`. Both name fields may be `null` or `""` when the profile
 * omits them — the handler normalises empty strings to `null` so a
 * cleared Clerk name clears the local copy and the roster projection
 * falls back to the email-derived name.
 *
 * We type the payload structurally and key off `type === 'user.updated'`
 * because the Clerk SDK's `WebhookEvent` union types `data` as the full
 * `UserJSON`; pinning only the two fields we trust keeps the handler
 * decoupled from SDK churn.
 */
export interface UserUpdatedEvent {
  readonly type: 'user.updated';
  readonly data: {
    readonly id: string;
    readonly first_name?: string | null;
    readonly last_name?: string | null;
  };
}

/**
 * Type guard for the `user.updated` event. Reads only the two fields we
 * trust (`type`, `data.id`); the name fields are read opportunistically
 * inside the handler.
 */
export function isUserUpdatedEvent(event: unknown): event is UserUpdatedEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as { type?: unknown; data?: unknown };
  if (e.type !== 'user.updated') return false;
  if (typeof e.data !== 'object' || e.data === null) return false;
  const d = e.data as { id?: unknown };
  return typeof d.id === 'string' && d.id.length > 0;
}

/**
 * Normalise a Clerk name field to `string | null`. Clerk may send `null`,
 * an empty string, or whitespace-only — all of which mean "no name".
 * Returning `null` for those keeps the persisted column clean so the
 * roster fallback logic (`resolveAthleteName`) triggers correctly.
 */
export function normalizeName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
