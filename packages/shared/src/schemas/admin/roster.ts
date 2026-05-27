/**
 * @repo/shared/schemas/admin/roster — Zod boundary schemas for the
 * org-wide athlete roster read surface.
 *
 * Introduced by Epic #10 / Story #661 / Task #692. The schemas are the
 * single contract enforced both at the API edge
 * (`apps/api/src/routes/v1/admin/roster.ts`) and at the web boundary
 * (`apps/web/src/pages/admin/roster.astro` + `RosterTable.tsx` —
 * Story #661 / Task #693).
 *
 * The roster endpoint is **read-only** on this Story, so there is no
 * input-body schema — the only client surface is the query string,
 * which the router validates with `RosterQuerySchema` below.
 *
 * `RosterItemSchema` describes one row of the paginated response. It is
 * a derived projection over `athlete_memberships ⋈ users ⋈ teams` —
 * the `fullName` column is computed from `users.email` (no name column
 * exists on `users` yet) and `verifiedAchievementCount` is pinned to
 * `0` (no achievements table yet, but the contract reserves the column
 * so the page can render it without a future wire-shape break).
 *
 * Schemas use `.strict()` so unknown keys are a hard failure.
 */

import { z } from 'zod';

const NONEMPTY = z.string().trim().min(1).max(200);

/**
 * Query-string contract for `GET /api/v1/admin/roster`.
 *
 *   - `teamId` narrows the result set to athletes on the named team.
 *   - `sport` narrows by the team's `sport` column.
 *   - `cursor` is an opaque server-issued string returned as
 *     `nextCursor` in the previous page's response. Clients MUST treat
 *     it as opaque (do not parse or construct one client-side).
 *   - `limit` defaults to 50; the router clamps it at 200.
 *
 * Numeric coercion is applied to `limit` because query strings arrive
 * as strings. The schema rejects non-numeric input rather than
 * silently falling back to the default.
 */
export const RosterQuerySchema = z
  .object({
    teamId: NONEMPTY.optional(),
    sport: NONEMPTY.optional(),
    cursor: NONEMPTY.optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  })
  .strict();

export type RosterQuery = z.infer<typeof RosterQuerySchema>;

/**
 * Public projection for one roster row. Pins the **public** athlete
 * fields and omits any internal columns (clerk subject id, raw user
 * row state) so a future refactor that widens the handler's return
 * type cannot accidentally leak server-only data.
 */
export const RosterItemSchema = z
  .object({
    /**
     * The `athlete_memberships.id` for this athlete's active membership
     * on `teamId`. Required because the season-rollover surface keys
     * its per-row decisions on `membershipId` — the planner at
     * `@repo/shared/rollover/buildPlan` and the
     * `/api/v1/admin/rollover/*` endpoints reject any other shape with
     * `UNKNOWN_MEMBERSHIP`. Surfaced by the roster projection so the
     * client never has to synthesize one (Story #972 — the original
     * synthesized-from-athleteId shape silently broke rollover).
     */
    membershipId: z.string(),
    athleteId: z.string(),
    fullName: z.string(),
    teamId: z.string(),
    teamName: z.string(),
    sport: z.string(),
    ageGroup: z.string(),
    verifiedAchievementCount: z.number().int().nonnegative(),
  })
  .strict();

export type RosterItem = z.infer<typeof RosterItemSchema>;

/**
 * The `data` shape of the canonical envelope returned by
 * `GET /api/v1/admin/roster`:
 *
 *   { success: true, data: { items: [...], nextCursor: string | null } }
 *
 * `nextCursor` is `null` when the page is the last one (no further
 * rows). Clients pass it back verbatim as `?cursor=` to fetch the next
 * page.
 */
export const RosterPageSchema = z
  .object({
    items: z.array(RosterItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type RosterPage = z.infer<typeof RosterPageSchema>;
