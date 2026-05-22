/**
 * @repo/shared/schemas/admin/rollover — Zod boundary schemas for the
 * season-rollover preview + commit surface (Epic #10 / Story #665 /
 * Task #695).
 *
 * Two endpoints share the same request body shape:
 *
 *   - POST /api/v1/admin/rollover/preview — compute the plan, no DB
 *     write
 *   - POST /api/v1/admin/rollover/commit  — apply the plan
 *     transactionally; re-runs the builder server-side and rejects
 *     with 409 STALE_PLAN if the recomputed plan differs from the
 *     `expectedPlan` the client carried back from preview.
 *
 * The commit body extends the preview body with an `expectedPlan`
 * field (the canonical plan shape the client received from preview).
 * The router serializes the recomputed plan and compares it against
 * the submitted plan — equal → apply; differ → 409 STALE_PLAN.
 *
 * Schemas use `.strict()` so stale client field names cannot slip
 * through silently.
 */

import { z } from 'zod';

const TRIMMED_NONEMPTY = z.string().trim().min(1).max(200);
const ID = z.string().trim().min(1).max(120);

export const RolloverDecisionSchema = z.enum(['promote', 'archive', 'transfer']);

export const RolloverChoiceSchema = z
  .object({
    membershipId: ID,
    decision: RolloverDecisionSchema,
    targetTeamId: ID.optional(),
  })
  .strict();

export type RolloverChoiceInput = z.infer<typeof RolloverChoiceSchema>;

/**
 * Body of `POST /api/v1/admin/rollover/preview`.
 *
 *   - `sourceSeason` — the season string the operator is rolling out of
 *     (matches `teams.season`).
 *   - `targetSeason` — the season string the operator is rolling into
 *     (informational; teams in this season must already exist).
 *   - `choices` — per-membership decisions. May be empty (the response
 *     then reports an empty plan).
 */
export const RolloverPreviewInputSchema = z
  .object({
    sourceSeason: TRIMMED_NONEMPTY,
    targetSeason: TRIMMED_NONEMPTY,
    choices: z.array(RolloverChoiceSchema).max(5000),
  })
  .strict();

export type RolloverPreviewInput = z.infer<typeof RolloverPreviewInputSchema>;

// ── Plan output shapes (mirror the buildPlan return type) ─────────────

export const ArchiveWriteSchema = z
  .object({
    membershipId: ID,
    athleteUserId: ID,
    sourceTeamId: ID,
    reason: z.enum(['promote', 'archive', 'transfer']),
  })
  .strict();

export const PromotionWriteSchema = z
  .object({
    athleteUserId: ID,
    orgId: ID,
    sourceTeamId: ID,
    targetTeamId: ID,
    reason: z.enum(['promote', 'transfer']),
  })
  .strict();

export const RolloverErrorSchema = z
  .object({
    membershipId: ID,
    code: z.enum(['UNKNOWN_MEMBERSHIP', 'MISSING_TARGET_TEAM', 'ALREADY_ENDED']),
  })
  .strict();

export const RolloverPlanSchema = z
  .object({
    archives: z.array(ArchiveWriteSchema),
    promotions: z.array(PromotionWriteSchema),
    errors: z.array(RolloverErrorSchema),
  })
  .strict();

export type RolloverPlanOutput = z.infer<typeof RolloverPlanSchema>;

/**
 * Body of `POST /api/v1/admin/rollover/commit`.
 *
 *   - Same as `RolloverPreviewInputSchema`, plus:
 *   - `expectedPlan` — the exact plan the client received from preview.
 *     The router re-runs `buildPlan` server-side against the current DB
 *     state and rejects with `STALE_PLAN` (HTTP 409) if the recomputed
 *     plan differs from this expectation.
 */
export const RolloverCommitInputSchema = z
  .object({
    sourceSeason: TRIMMED_NONEMPTY,
    targetSeason: TRIMMED_NONEMPTY,
    choices: z.array(RolloverChoiceSchema).max(5000),
    expectedPlan: RolloverPlanSchema,
  })
  .strict();

export type RolloverCommitInput = z.infer<typeof RolloverCommitInputSchema>;
