/**
 * @repo/shared/db/schema/legalDocuments — production Drizzle table.
 *
 * Catalog of versioned legal documents (Terms of Service, Privacy Policy)
 * introduced by Epic #8 / Tech Spec #490 to power the onboarding gate.
 *
 * The active row per `kind` is the most-recent `effective_at <= now()`;
 * the composite index `(kind, effective_at desc)` is what makes the
 * "currently-active document" lookup cheap.
 *
 * `kind` is pinned at the SQL layer by a CHECK constraint to one of
 * `'terms_of_service'` or `'privacy_policy'`. The Zod boundary in
 * `packages/shared/src/schemas/auth.ts` mirrors this union, but the CHECK
 * is the load-bearing defence — direct SQL inserts (seeds, migrations)
 * cannot smuggle in a bad kind.
 */

import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const legalDocuments = sqliteTable(
  'legal_documents',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    version: text('version').notNull(),
    effectiveAt: integer('effective_at', { mode: 'timestamp' }).notNull(),
    bodyUrl: text('body_url').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    kindCheck: check(
      'legal_documents_kind_check',
      sql`${table.kind} IN ('terms_of_service', 'privacy_policy')`,
    ),
    kindEffectiveAtIdx: index('legal_documents_kind_effective_at_idx').on(
      table.kind,
      sql`${table.effectiveAt} DESC`,
    ),
  }),
);

export type LegalDocument = typeof legalDocuments.$inferSelect;
export type NewLegalDocument = typeof legalDocuments.$inferInsert;
