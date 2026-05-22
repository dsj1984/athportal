// Zod boundary schemas for the season-rollover preview + commit surface
// (Epic #10 / Story #665). Preview computes the plan; commit re-runs
// buildPlan server-side and rejects with 409 STALE_PLAN if the recomputed
// plan differs from the expectedPlan the client carried back from preview.

import { z } from 'zod';

const STR = z.string().trim().min(1).max(200);
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

export const RolloverPreviewInputSchema = z
  .object({
    sourceSeason: STR,
    targetSeason: STR,
    choices: z.array(RolloverChoiceSchema).max(5000),
  })
  .strict();

export type RolloverPreviewInput = z.infer<typeof RolloverPreviewInputSchema>;

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

export const RolloverCommitInputSchema = RolloverPreviewInputSchema.extend({
  expectedPlan: RolloverPlanSchema,
}).strict();

export type RolloverCommitInput = z.infer<typeof RolloverCommitInputSchema>;
