/**
 * @repo/shared/schemas/coach/roster — Zod boundary schemas for the
 * coach-owned roster surface (Epic #11 / Story #910 / Task #911).
 *
 * Tech Spec #906 §API Changes nominates this file as the single contract
 * enforced at the API edge (`apps/api/src/routes/v1/coach/roster.ts`)
 * and the public accept/decline endpoints under
 * `apps/api/src/routes/v1/public/roster-invites.ts`.
 *
 * Schemas use `.strict()` so unknown keys are a hard failure — a stale
 * client field name cannot silently slip through. Sibling-of-convention
 * with `@repo/shared/schemas/admin/roster` (Epic #10 / Story #661 /
 * Task #692) — the admin file owns the org-wide read surface, this file
 * owns the coach-scoped mutate surface.
 */

import { z } from 'zod';

/**
 * Jersey number contract. Stored as `text` in `roster_entry.jersey_number`
 * so leading zeros and "00" are preserved (per Tech Spec §Data Models).
 * Must match the CHECK constraint `^[0-9]{1,3}$` declared on the column.
 */
const JERSEY_NUMBER_PATTERN = /^[0-9]{1,3}$/;
const PRIMARY_POSITION_MAX = 32;

/**
 * Input contract for `POST /api/v1/coach/teams/:teamId/roster/invites`.
 *
 * - `email` is lowercased on success so the persisted row matches the
 *   "lowercased on insert" rule in Tech Spec §Data Models. The Zod
 *   transform runs *before* `.strict()` rejection, so callers can submit
 *   `Coach@Example.com` and the parser returns `coach@example.com`.
 * - `firstName` / `lastName` are optional UI affordances and bounded at
 *   80 chars to match the persisted column shape.
 */
export const InviteAthleteInput = z
  .object({
    email: z
      .string()
      .trim()
      .min(3)
      .max(254)
      .email()
      .transform((v) => v.toLowerCase()),
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type InviteAthleteInput = z.infer<typeof InviteAthleteInput>;

/**
 * Input contract for
 * `PATCH /api/v1/coach/teams/:teamId/roster/entries/:entryId`.
 *
 * Both fields are independently optional so a coach can update just one
 * column without resending the other. At least one field is required —
 * empty patches are rejected via `.refine()` to prevent no-op writes.
 *
 * `jerseyNumber` accepts `null` so the coach can clear the value;
 * the Zod schema does NOT accept arbitrary numeric input — strings only,
 * matching the column type and CHECK constraint.
 *
 * `primaryPosition` is bounded server-side at 32 chars per Tech Spec
 * §Data Models even though the client may suggest longer values.
 */
export const EditRosterEntryInput = z
  .object({
    jerseyNumber: z
      .string()
      .regex(JERSEY_NUMBER_PATTERN, 'jerseyNumber must be 1-3 digits')
      .nullable()
      .optional(),
    primaryPosition: z.string().trim().max(PRIMARY_POSITION_MAX).nullable().optional(),
  })
  .strict()
  .refine(
    (v) => v.jerseyNumber !== undefined || v.primaryPosition !== undefined,
    'at least one of jerseyNumber or primaryPosition must be provided',
  );

export type EditRosterEntryInput = z.infer<typeof EditRosterEntryInput>;

/**
 * Public projection of one `roster_entry` row joined with the athlete's
 * user surface. Pins the **public** fields the coach roster page renders
 * and explicitly omits internal columns (org_id, denormalised audit
 * columns) so a future refactor that widens the handler's return type
 * cannot accidentally leak server-only data.
 */
export const RosterEntryOutput = z
  .object({
    id: z.string(),
    teamId: z.string(),
    athleteUserId: z.string(),
    athleteEmail: z.string(),
    athleteFullName: z.string(),
    jerseyNumber: z.string().nullable(),
    primaryPosition: z.string().nullable(),
    endedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type RosterEntryOutput = z.infer<typeof RosterEntryOutput>;

/**
 * Lifecycle states for a `roster_invite` row. Mirrors the literal set
 * in Tech Spec #906 §Data Models `roster_invite.status`. Kept as a
 * frozen tuple so the literal type flows into `RosterInviteStatus`
 * and downstream callers cannot drift the spelling.
 */
export const ROSTER_INVITE_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'revoked',
] as const;
export type RosterInviteStatus = (typeof ROSTER_INVITE_STATUSES)[number];

/**
 * Public projection of one `roster_invite` row. The plaintext token is
 * NEVER part of the response shape — it is emitted only in the
 * recipient's email body. Status and timestamps are surfaced so the
 * coach UI can render the invites table.
 */
export const RosterInviteOutput = z
  .object({
    id: z.string(),
    teamId: z.string(),
    email: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    status: z.enum(ROSTER_INVITE_STATUSES),
    expiresAt: z.string(),
    acceptedAt: z.string().nullable(),
    declinedAt: z.string().nullable(),
    invitedByUserId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type RosterInviteOutput = z.infer<typeof RosterInviteOutput>;
