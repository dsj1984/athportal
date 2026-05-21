/**
 * @repo/shared/schemas/auth — Zod boundary schemas for the onboarding
 * endpoint.
 *
 * Introduced by Epic #8 / Story #555 / Task #568. Tech Spec #490.
 *
 * Two schemas:
 *
 *   - `OnboardInputSchema` validates the body of `POST /api/v1/auth/onboard`
 *     at the API edge AND the matching `react-hook-form` resolver on the
 *     web `/onboarding` page. The shared schema is the load-bearing
 *     contract that keeps the two boundaries in step.
 *
 *   - `OnboardOutputSchema` describes the canonical-envelope `data` shape
 *     returned on successful onboarding. It pins the **public** user
 *     fields and explicitly omits internal columns (`createdAt`,
 *     `updatedAt`, `clerkSubjectId`) so a future refactor that widens the
 *     handler's return type cannot accidentally leak server-only data.
 *
 * Schemas use `.strict()` so unknown keys are a hard failure — a stale
 * client field name (e.g. an old `acceptedTerms: true` boolean from a
 * pre-versioning UI) cannot silently slip through.
 */

import { z } from 'zod';

const profileSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
  })
  .strict();

// `isAtLeast13` MUST be the literal `true`. Using `z.literal(true)` rather
// than `z.boolean().refine(v => v === true)` produces a clearer error
// (`Invalid literal value, expected true`) and keeps the constraint visible
// at the type level (`isAtLeast13: true`).
const ageAttestationSchema = z
  .object({
    isAtLeast13: z.literal(true),
  })
  .strict();

const legalAcceptancesSchema = z
  .object({
    termsOfServiceVersion: z.string().min(1),
    privacyPolicyVersion: z.string().min(1),
  })
  .strict();

export const OnboardInputSchema = z
  .object({
    profile: profileSchema,
    ageAttestation: ageAttestationSchema,
    legalAcceptances: legalAcceptancesSchema,
    inviteToken: z.string().min(1).optional(),
    profilePhotoUploadId: z.string().min(1).optional(),
  })
  .strict();

export type OnboardInput = z.infer<typeof OnboardInputSchema>;

/**
 * Public-facing user shape returned by the onboarding handler. Internal
 * columns (`createdAt`, `updatedAt`, `clerkSubjectId`) are intentionally
 * absent so a future refactor that widens the handler's return type
 * cannot leak server-only data.
 */
const publicUserSchema = z
  .object({
    userId: z.string().min(1),
    role: z.string().min(1),
    orgId: z.string().nullable(),
    teamId: z.string().nullable(),
    email: z.string().email(),
    onboardedAt: z.date(),
  })
  .strict();

export const OnboardOutputSchema = z
  .object({
    user: publicUserSchema,
    onboardedAt: z.date(),
  })
  .strict();

export type OnboardOutput = z.infer<typeof OnboardOutputSchema>;
