/**
 * @repo/shared/db/schema/userLegalAgreements — production Drizzle table.
 *
 * Join table capturing each user's acceptance of a versioned legal
 * document, introduced by Epic #8 / Tech Spec #490. The single-transaction
 * onboarding handler writes one row per accepted document (Terms of
 * Service + Privacy Policy) keyed to the resolved active `legalDocuments`
 * row at submission time.
 *
 * `user_id` cascades on delete — removing the user removes their
 * acceptances. `legal_document_id` is RESTRICT to preserve the audit
 * trail: a `legalDocuments` row that has any accepting users cannot be
 * deleted without first re-homing or removing those acceptances.
 *
 * The unique index on `(user_id, legal_document_id)` is the defence in
 * depth against duplicate acceptance rows produced by replays of the
 * onboarding handler.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { legalDocuments } from './legalDocuments';
import { users } from './users';

export const userLegalAgreements = sqliteTable(
  'user_legal_agreements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    legalDocumentId: text('legal_document_id')
      .notNull()
      .references(() => legalDocuments.id, { onDelete: 'restrict' }),
    acceptedAt: integer('accepted_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    userDocumentUnique: uniqueIndex('user_legal_agreements_user_document_unique').on(
      table.userId,
      table.legalDocumentId,
    ),
  }),
);

export type UserLegalAgreement = typeof userLegalAgreements.$inferSelect;
export type NewUserLegalAgreement = typeof userLegalAgreements.$inferInsert;
