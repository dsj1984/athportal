// apps/api/src/lib/clerk-invitations.ts
//
// Thin wrapper around @clerk/backend's invitation API. Epic #10 /
// Story #655 / Task #666.
//
// The wrapper isolates the third-party SDK behind three named verbs
// (`createInvitation`, `resendInvitation`, `revokeInvitation`) so:
//
//   1. Route handlers in `apps/api/src/routes/v1/admin/invitations/*`
//      depend on a small, project-shaped surface instead of the full
//      Clerk client. The handlers' contract tests can swap a single
//      mock here rather than mocking `@clerk/backend` everywhere.
//   2. Clerk does NOT expose a first-class "resend" verb on its
//      invitation endpoint (see
//      `@clerk/backend/dist/api/endpoints/InvitationApi.d.ts`: the
//      surface is `getInvitationList | createInvitation | revokeInvitation`).
//      The accepted resend semantics across the Clerk ecosystem are
//      "revoke + recreate"; centralising that two-step here keeps
//      callers honest and prevents drift across the three call sites
//      (resend endpoint, retry path, admin re-send button).
//
// Per `.agents/rules/security-baseline.md` (Authentication, Secrets
// Management): the Clerk secret key is sourced from the Worker `Env`
// binding by the caller and passed in; this module never reads
// `process.env` or constructs a fallback secret. Construction of the
// Clerk client is a caller responsibility so a single client can be
// reused per request rather than rebuilt per verb.

import { type ClerkClient } from '@clerk/backend';
import type { InvitationRole } from '@repo/shared/db/schema';

/**
 * Subset of the Clerk client surface this wrapper consumes. Declaring
 * the shape locally (instead of accepting the full `ClerkClient`) lets
 * contract tests pass a hand-rolled stub without satisfying every
 * unrelated method on the SDK.
 */
export interface ClerkInvitationClient {
  readonly invitations: {
    createInvitation(params: {
      emailAddress: string;
      publicMetadata?: Record<string, unknown>;
      redirectUrl?: string;
    }): Promise<{ id: string }>;
    revokeInvitation(invitationId: string): Promise<unknown>;
  };
}

/**
 * Public metadata payload carried on the invitation. Clerk persists
 * this verbatim and surfaces it on the matching `user.publicMetadata`
 * once the recipient accepts. The shape is intentionally narrow — the
 * webhook handler (`apps/api/src/routes/webhooks/clerk-invitation-accepted.ts`)
 * reads back exactly these three fields, so any drift here surfaces
 * immediately at the contract test that exercises the accept path.
 */
export interface InvitationPublicMetadata {
  readonly orgId: string;
  readonly role: InvitationRole;
  readonly teamIds: readonly string[];
}

export interface CreateInvitationInput {
  readonly email: string;
  readonly orgId: string;
  readonly role: InvitationRole;
  readonly teamIds: readonly string[];
  readonly redirectUrl?: string;
}

export interface CreateInvitationResult {
  readonly clerkInvitationId: string;
}

/**
 * Create a Clerk invitation. The Clerk-side row carries the
 * `(orgId, role, teamIds)` triple in `publicMetadata` so the accept
 * webhook can reconstruct the membership rows without a join back to
 * our local `invitations` table.
 */
export async function createInvitation(
  client: ClerkInvitationClient,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const metadata: InvitationPublicMetadata = {
    orgId: input.orgId,
    role: input.role,
    teamIds: [...input.teamIds],
  };
  const result = await client.invitations.createInvitation({
    emailAddress: input.email,
    publicMetadata: metadata as unknown as Record<string, unknown>,
    redirectUrl: input.redirectUrl,
  });
  return { clerkInvitationId: result.id };
}

/**
 * Resend a Clerk invitation. The Clerk Backend API does not expose a
 * first-class resend verb, so the canonical pattern is revoke +
 * recreate. The recreated invitation gets a new Clerk id; callers MUST
 * persist the returned `clerkInvitationId` so the local row's
 * `clerk_invitation_id` column tracks the live Clerk row (the old id
 * is no longer accept-able).
 */
export async function resendInvitation(
  client: ClerkInvitationClient,
  input: CreateInvitationInput & { previousClerkInvitationId: string },
): Promise<CreateInvitationResult> {
  await client.invitations.revokeInvitation(input.previousClerkInvitationId);
  return createInvitation(client, input);
}

/**
 * Revoke a Clerk invitation. The local row's `status` flip to
 * `'revoked'` is the caller's responsibility and MUST happen only
 * after this call resolves — a third-party failure leaves the local
 * row at `'pending'` so the operator can retry without orphaning the
 * Clerk side.
 */
export async function revokeInvitation(
  client: ClerkInvitationClient,
  clerkInvitationId: string,
): Promise<void> {
  await client.invitations.revokeInvitation(clerkInvitationId);
}

/**
 * Build a `ClerkInvitationClient` from a full `ClerkClient`. The
 * production binding lives in the API entrypoint; tests pass a
 * hand-rolled stub directly.
 */
export function asInvitationClient(client: ClerkClient): ClerkInvitationClient {
  return {
    invitations: {
      createInvitation: (params) => client.invitations.createInvitation(params),
      revokeInvitation: (id) => client.invitations.revokeInvitation(id),
    },
  };
}
