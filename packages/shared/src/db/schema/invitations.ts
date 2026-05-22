/**
 * @repo/shared/db/schema/invitations — production Drizzle table.
 *
 * Epic #10 / Story #655 (Task #670). Records one row per pending
 * Clerk-issued invitation so an `org_admin` can list, re-send, and
 * revoke invitations before the recipient accepts. Clerk owns the
 * email send + accept handshake; this row carries only metadata the
 * admin surface needs (the `clerk_invitation_id` is the join key back
 * to Clerk's invitation API).
 *
 * Cross-tenant scoping mirrors `coachAssignments` and
 * `athleteMemberships` from Epic #9: the denormalised `org_id` column
 * is indexed so the query-layer `scopedDb(actor)` helper can prefix
 * every read and write with `where org_id = :actor_org_id`. Without
 * that index a list query at the admin surface would scan the entire
 * table across every tenant.
 *
 * Lifecycle:
 *   - `pending`  — Clerk has issued the invitation; the recipient has
 *                  not accepted yet.
 *   - `accepted` — flipped by the `invitation.accepted` webhook handler
 *                  (Task #666). The matching membership row
 *                  (`coach_assignments` for `role === 'coach'`,
 *                  `athlete_memberships` for `role === 'athlete'`) is
 *                  inserted in the same transaction.
 *   - `revoked`  — flipped when an admin calls the revoke endpoint
 *                  (Task #668). The matching Clerk invitation is
 *                  revoked first; we update the local row only after
 *                  the third-party call succeeds.
 *
 * `clerk_invitation_id` is UNIQUE so the webhook handler's idempotency
 * key is enforced at the persistence layer — a duplicate
 * `invitation.accepted` for the same Clerk id MUST NOT create a
 * duplicate membership row.
 *
 * `team_ids` is stored as a JSON-encoded `text` column on SQLite per
 * the Tech Spec §Data Models note: SQLite has no native array type
 * and Drizzle's `text({ mode: 'json' })` keeps the call-site shape
 * (`string[]`) typed without dragging a side-table along.
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations } from './organizations';
import { users } from './users';

/**
 * Lifecycle states for an invitation row. Kept as a frozen tuple so the
 * literal type flows into `InvitationStatus` and downstream callers
 * cannot drift the spelling.
 */
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * Role assigned to the invitee on accept. Matches the two membership
 * surfaces the accept webhook writes to (`coach_assignments` and
 * `athlete_memberships`). `org_admin` and `dev_admin` are NOT issuable
 * via this surface — they are provisioned out-of-band.
 */
export const INVITATION_ROLES = ['coach', 'athlete'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    email: text('email').notNull(),
    role: text('role').notNull().$type<InvitationRole>(),
    // SQLite stores arrays as JSON text. The mode hint preserves the
    // `string[]` call-site shape without forcing a side-table.
    teamIds: text('team_ids', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    clerkInvitationId: text('clerk_invitation_id').notNull(),
    status: text('status').notNull().$type<InvitationStatus>().default('pending'),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    // Load-bearing for the admin list query: `scopedDb` prefixes every
    // read with `where org_id = :actor_org_id`. Without this index the
    // list endpoint would scan the entire table.
    orgIdIdx: index('invitations_org_id_idx').on(table.orgId),
    // Idempotency key for the accept webhook handler. Forces the
    // duplicate-delivery contract at the persistence layer rather than
    // trusting application-level state.
    clerkInvitationIdUnique: uniqueIndex('invitations_clerk_invitation_id_unique').on(
      table.clerkInvitationId,
    ),
  }),
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
