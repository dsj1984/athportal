/**
 * @repo/shared/schemas/admin/invitations — Zod boundary schemas for the
 * org-admin direct-invitation surface.
 *
 * Introduced by Epic #10 / Story #662 / Task #680. Currently scopes a
 * single schema for the direct-athlete-invite POST body
 * (`POST /api/v1/admin/invitations/athlete`). The schema is the single
 * contract enforced at the API edge
 * (`apps/api/src/routes/v1/admin/invitations/router.ts`) and at the web
 * form boundary
 * (`apps/web/src/components/admin/invitations/AthleteInviteForm.tsx` —
 * Story #662 / Task #681).
 *
 * `.strict()` is used so unknown keys (e.g. a future `role` field that
 * a stale client tries to forge) are a hard 400 — the route never
 * trusts a client-asserted role; the role is pinned to `'athlete'` on
 * the server.
 */

import { z } from 'zod';

/**
 * Body of `POST /api/v1/admin/invitations/athlete`. Both fields are
 * required. The actor's orgId is the only tenant scope — clients MUST
 * NOT supply `orgId` in the body (the `.strict()` rejection covers
 * this).
 *
 * `email` is normalised to lower-case so the persistence layer never
 * stores two different invitations for the same logical address.
 *
 * `teamId` is verified server-side to belong to the actor's org before
 * any Clerk call or DB insert fires — a cross-tenant teamId returns
 * 404 NOT_FOUND (no cross-tenant existence oracle).
 */
export const AthleteInvitationCreateInputSchema = z
  .object({
    email: z.string().trim().email().toLowerCase().max(254),
    teamId: z.string().trim().min(1).max(120),
  })
  .strict();

export type AthleteInvitationCreateInput = z.infer<typeof AthleteInvitationCreateInputSchema>;
