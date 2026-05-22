/**
 * @repo/shared/schemas/admin/reports — Zod boundary schemas for the
 * org-scoped admin report surface.
 *
 * Introduced by Epic #10 / Story #679 / Task #698. The schemas are the
 * single contract enforced both at the API edge
 * (`apps/api/src/routes/v1/admin/reports.ts`) and at the web boundary
 * (`apps/web/src/pages/admin/reports.astro` +
 * `VerifiedAchievementReport.ts` — Task #699).
 *
 * The verified-achievement report is **read-only** and takes no input —
 * the actor's org is derived from `c.var.auth.orgId` and there are no
 * query filters on this Story. The endpoint returns aggregation counts
 * by team and by sport for the actor's org.
 *
 * ⚠️ Upstream note (Story #661 carried the same caveat for the roster
 * endpoint): there is **no `verified_achievements` table on epic/10
 * yet**. Story #661 pinned `verifiedAchievementCount: 0` for every
 * athlete on that exact rationale; we follow the same pattern here and
 * report `verifiedAchievementCount: 0` for every aggregation row, with
 * the row set computed from the real `teams` and `athlete_memberships`
 * tables so the v1.0 achievements Epic can swap in the real count
 * without changing the wire shape.
 *
 * Schemas use `.strict()` so unknown keys are a hard failure.
 */

import { z } from 'zod';

/**
 * One row of the by-team aggregation. The `teamId` / `teamName` pair
 * mirrors the projection used by the roster endpoint so the page can
 * render the two surfaces with a shared label vocabulary.
 */
export const VerifiedAchievementByTeamSchema = z
  .object({
    teamId: z.string(),
    teamName: z.string(),
    verifiedAchievementCount: z.number().int().nonnegative(),
  })
  .strict();

export type VerifiedAchievementByTeam = z.infer<typeof VerifiedAchievementByTeamSchema>;

/**
 * One row of the by-sport aggregation. `sport` is the `teams.sport`
 * column verbatim (no normalization), matching the roster page's
 * `?sport=` filter contract.
 */
export const VerifiedAchievementBySportSchema = z
  .object({
    sport: z.string(),
    verifiedAchievementCount: z.number().int().nonnegative(),
  })
  .strict();

export type VerifiedAchievementBySport = z.infer<typeof VerifiedAchievementBySportSchema>;

/**
 * The `data` shape of the canonical envelope returned by
 * `GET /api/v1/admin/reports/verified-achievements`:
 *
 *   { success: true, data: { byTeam: [...], bySport: [...] } }
 *
 * Both arrays are ordered alphabetically by their label
 * (`teamName` / `sport`) for deterministic rendering. Empty orgs return
 * empty arrays — never `null`.
 */
export const VerifiedAchievementReportSchema = z
  .object({
    byTeam: z.array(VerifiedAchievementByTeamSchema),
    bySport: z.array(VerifiedAchievementBySportSchema),
  })
  .strict();

export type VerifiedAchievementReport = z.infer<typeof VerifiedAchievementReportSchema>;
