// apps/api/src/routes/webhooks/clerk-invitation-shared.ts
//
// Shared types and event-shape narrowing for the Clerk invitation
// webhook handler. Extracted so the contract test can import the same
// `VerifyWebhook` shape and `isInvitationAcceptedEvent` narrower as
// the handler, without dragging the runtime route module (and its
// dynamic `@clerk/backend/webhooks` import) into the test bundle.

import type { InvitationRole } from '@repo/shared/db/schema';

/**
 * Public metadata payload carried on the Clerk invitation. Mirrors the
 * shape `apps/api/src/lib/clerk-invitations.ts` writes when creating
 * the invitation — the two are a versioned pair: changing one without
 * the other breaks the accept handshake and the contract test in
 * `clerk-invitation-accepted.contract.test.ts` catches the drift.
 */
export interface InvitationPublicMetadata {
  readonly orgId: string;
  readonly role: InvitationRole;
  readonly teamIds: readonly string[];
}

/**
 * Minimal shape of the verifier the handler depends on. Matches the
 * signature exported by `@clerk/backend/webhooks#verifyWebhook` but
 * keeps the test bundle free of that import — the test seam fakes the
 * verifier directly via `c.set('verifyWebhook', fake)`.
 */
export type VerifyWebhook = (
  request: Request,
  options: { signingSecret: string },
) => Promise<unknown>;

/**
 * Narrowed shape of the `invitation.accepted` event we consume. The
 * Clerk SDK's `WebhookEvent` union does not include this event type
 * directly (it ships `organizationInvitation.accepted`), so we type
 * the payload structurally and key off `type === 'invitation.accepted'`.
 *
 * The Tech Spec #647 §Architecture & Design pins the event-name
 * contract: the application-level invitation flow uses
 * `invitation.accepted`. If a future Clerk SDK release adds the type
 * to its native union, swap the narrowing for that union without
 * changing the call site.
 */
export interface InvitationAcceptedEvent {
  readonly type: 'invitation.accepted';
  readonly data: {
    readonly id: string;
    readonly user_id?: string;
    readonly userId?: string;
    readonly publicMetadata?: InvitationPublicMetadata;
    readonly public_metadata?: InvitationPublicMetadata;
  };
}

/**
 * Type guard for the accept event. Reads only the two fields we trust
 * (`type`, `data.id`); the rest is opportunistically narrowed inside
 * the handler.
 */
export function isInvitationAcceptedEvent(event: unknown): event is InvitationAcceptedEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as { type?: unknown; data?: unknown };
  if (e.type !== 'invitation.accepted') return false;
  if (typeof e.data !== 'object' || e.data === null) return false;
  const d = e.data as { id?: unknown };
  return typeof d.id === 'string' && d.id.length > 0;
}
