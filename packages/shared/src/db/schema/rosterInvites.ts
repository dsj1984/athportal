/**
 * @repo/shared/db/schema/rosterInvites — production Drizzle table.
 *
 * Epic #11 / Story #910 / Task #916. One row per outstanding
 * coach-issued invitation. **Distinct** from `invitations` (the
 * Clerk-mediated org-admin invite surface introduced by Epic #10) per
 * Tech Spec #906 §Overview: roster invites operate on already-onboarded
 * athlete identities and produce an `athlete_memberships` row plus a
 * `roster_entry` row in the same transaction on accept. The two
 * surfaces deliberately do not share a table — see the ADR
 * "Roster invites are separate from Clerk org-admin invitations"
 * referenced by the Tech Spec.
 *
 * Token storage contract (Tech Spec §Security & Privacy):
 *   - The plaintext token (32 random bytes, 256 bits) is emitted ONLY
 *     in the invite email body and never persisted at rest.
 *   - `token_hash` stores the SHA-256 of the plaintext token. The
 *     unique index on this column makes the public accept-route
 *     lookup an indexed point read and refuses any duplicate-hash
 *     insert.
 *   - Constant-time comparison happens at the route layer; this
 *     schema only pins the persistence surface.
 *
 * Status lifecycle:
 *   - `pending`  — invite issued, awaiting recipient action.
 *   - `accepted` — recipient accepted (matching `athlete_memberships`
 *                  + `roster_entry` row inserted in the same tx).
 *   - `declined` — recipient declined.
 *   - `expired`  — `expires_at < now()` at read time; transitioned
 *                  lazily by the read path (no nightly cron).
 *   - `revoked`  — coach cancelled the invite before accept.
 *
 * Cross-tenant integrity: every row's `org_id` MUST match the team's
 * `org_id` and the inviting user's `org_id`. Enforced by triggers
 * declared in migration 0007 and by `scopedDb(actor)` on every write.
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations } from './organizations';
import { teams } from './teams';
import { users } from './users';

/**
 * Lifecycle states for a `roster_invite` row. Kept as a frozen tuple
 * so the literal type flows into `RosterInviteStatus` and downstream
 * callers cannot drift the spelling. Mirrors the CHECK constraint
 * declared on `roster_invite.status` in migration 0007.
 */
export const ROSTER_INVITE_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'revoked',
] as const;
export type RosterInviteStatus = (typeof ROSTER_INVITE_STATUSES)[number];

export const rosterInvites = sqliteTable(
  'roster_invite',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    // SHA-256 of the plaintext token. Plaintext is never persisted.
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().$type<RosterInviteStatus>().default('pending'),
    // 7-day TTL is set at insert time by the route layer; the schema
    // pins only that the column is NOT NULL.
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
    declinedAt: integer('declined_at', { mode: 'timestamp' }),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    // Load-bearing for `scopedDb` prefixing every read with
    // `where org_id = :actor_org_id`.
    orgIdIdx: index('roster_invite_org_id_idx').on(table.orgId),
    // Composite for the coach's pending-invites list query.
    teamStatusIdx: index('roster_invite_team_status_idx').on(table.teamId, table.status),
    // Single-column index for the re-issue lookup ("is there already
    // an invite for this email on any team?").
    emailIdx: index('roster_invite_email_idx').on(table.email),
    // Unique constraint on token_hash — the public accept route's
    // sole authorization signal MUST be unforgeable at the
    // persistence layer.
    tokenHashUnique: uniqueIndex('roster_invite_token_hash_unique').on(table.tokenHash),
    // Single-pending-invite invariant (Story #1052 / F35): at most one
    // pending invite per (email, team_id). Partial so the constraint
    // applies only while a row is pending — accepted / declined /
    // expired / revoked rows for the same pair are unconstrained, which
    // keeps re-issue after expiry or revoke working. The race-safe
    // backstop behind the handler's pre-insert probe (409
    // INVITE_ALREADY_PENDING). Mirrors migration 0009.
    emailTeamPendingUnique: uniqueIndex('roster_invite_email_team_pending_unique')
      .on(table.email, table.teamId)
      .where(sql`${table.status} = 'pending'`),
  }),
);

export type RosterInvite = typeof rosterInvites.$inferSelect;
export type NewRosterInvite = typeof rosterInvites.$inferInsert;
