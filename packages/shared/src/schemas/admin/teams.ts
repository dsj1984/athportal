/**
 * @repo/shared/schemas/admin/teams — Zod boundary schemas for the
 * org-admin Team CRUD surface.
 *
 * Introduced by Epic #10 / Story #657 / Task #678. The schemas are the
 * single contract enforced both at the API edge
 * (`apps/api/src/routes/v1/admin/teams.ts`) and at the web form
 * boundary (`apps/web/src/components/admin/teams/TeamForm.tsx` —
 * Story #657 / Task #676).
 *
 * Three schemas:
 *
 *   - `TeamCreateInputSchema` validates the body of
 *     `POST /api/v1/admin/teams`. All four user-facing fields
 *     (`name`, `sport`, `season`, `ageGroup`) are required.
 *   - `TeamUpdateInputSchema` validates the body of
 *     `PATCH /api/v1/admin/teams/:id`. Every field is optional, but the
 *     payload MUST carry at least one field (a no-op PATCH is rejected
 *     as INVALID_BODY).
 *   - `TeamOutputSchema` describes the canonical-envelope `data` shape
 *     returned by every Team CRUD endpoint. It explicitly omits
 *     `deletedAt` so the soft-delete cleanup column (Epic #9 /
 *     Story #605) cannot leak through the public surface.
 *
 * Schemas use `.strict()` so unknown keys are a hard failure — a stale
 * client field name cannot silently slip through.
 */

import { z } from 'zod';

const TRIMMED_NONEMPTY = z.string().trim().min(1).max(120);

/**
 * Body of `POST /api/v1/admin/teams`. The actor's `orgId` is the only
 * tenant scope — clients MUST NOT supply `orgId` in the body (the
 * `.strict()` rejection covers this).
 */
export const TeamCreateInputSchema = z
  .object({
    name: TRIMMED_NONEMPTY,
    sport: TRIMMED_NONEMPTY,
    season: TRIMMED_NONEMPTY,
    ageGroup: TRIMMED_NONEMPTY,
  })
  .strict();

export type TeamCreateInput = z.infer<typeof TeamCreateInputSchema>;

/**
 * Body of `PATCH /api/v1/admin/teams/:id`. Every field is optional, but
 * the payload MUST be non-empty — a fully empty patch is rejected at
 * the boundary so the route never has to special-case the no-op write.
 */
export const TeamUpdateInputSchema = z
  .object({
    name: TRIMMED_NONEMPTY.optional(),
    sport: TRIMMED_NONEMPTY.optional(),
    season: TRIMMED_NONEMPTY.optional(),
    ageGroup: TRIMMED_NONEMPTY.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be supplied.',
  });

export type TeamUpdateInput = z.infer<typeof TeamUpdateInputSchema>;

/**
 * Public-team projection. Pins the **public** team fields and omits
 * internal columns (`deletedAt`) so a future refactor that widens the
 * handler's return type cannot accidentally leak server-only data.
 *
 * `archivedAt` is part of the public surface because clients use it to
 * render the archived/active toggle.
 */
export const TeamOutputSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    name: z.string(),
    sport: z.string(),
    season: z.string(),
    ageGroup: z.string(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type TeamOutput = z.infer<typeof TeamOutputSchema>;
