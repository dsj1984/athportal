/**
 * @repo/shared/db/schema/parentAthleteLinks — production Drizzle table.
 *
 * Join table linking a parent user to an athlete user, introduced by
 * Epic #8 / Tech Spec #490. The MVP only establishes links via invite
 * acceptance; the redeemed invite token is hashed with SHA-256 and the
 * hex digest is stored in `invite_token_hash`. The raw token is never
 * persisted.
 *
 * Both FK columns cascade on delete: removing either side of the link
 * removes the row. The unique index on `(parent_user_id, athlete_user_id)`
 * prevents duplicate links for the same pair.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const parentAthleteLinks = sqliteTable(
  'parent_athlete_links',
  {
    id: text('id').primaryKey(),
    parentUserId: text('parent_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    athleteUserId: text('athlete_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    establishedVia: text('established_via').notNull(),
    inviteTokenHash: text('invite_token_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    parentAthletePairUnique: uniqueIndex('parent_athlete_links_pair_unique').on(
      table.parentUserId,
      table.athleteUserId,
    ),
  }),
);

export type ParentAthleteLink = typeof parentAthleteLinks.$inferSelect;
export type NewParentAthleteLink = typeof parentAthleteLinks.$inferInsert;
