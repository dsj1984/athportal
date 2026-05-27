/**
 * @repo/shared/db/schema/csvImportBatches — production Drizzle table.
 *
 * Epic #10 / Story #663 / Task #688. Persists one audit row per
 * attempted CSV import batch so an `org_admin` can inspect prior
 * runs from the admin UI (Task #689) and see exactly which rows
 * succeeded, which were re-used against existing accounts, and which
 * failed validation. The import endpoint (Task #687) writes one row
 * per commit attempt inside the same Drizzle transaction that issues
 * the membership/invitation writes — failed commits roll the row back
 * along with the rest of the transaction, so the table never contains
 * an audit row for a transaction that did not land.
 *
 * Cross-tenant scoping mirrors `invitations` and `athleteMemberships`
 * from Epic #9: the denormalised `org_id` column is indexed so the
 * query-layer `scopedDb(actor)` helper can prefix every read with
 * `where org_id = :actor_org_id`. The admin "view past imports"
 * surface must never expose a peer org's batches.
 *
 * `errorEnvelope` is a JSON-encoded text column carrying the full
 * per-row error payload (`{ rowIndex, code, field? }[]`) that the
 * parser surfaces on a soft-failure preview run. On a successful
 * commit, the payload is the empty array `[]` so the column shape is
 * stable across both outcomes — admins reviewing prior runs always
 * see the same JSON shape.
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organizations } from './organizations';
import { users } from './users';

export const csvImportBatches = sqliteTable(
  'csv_import_batches',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    importedByUserId: text('imported_by_user_id')
      .notNull()
      .references(() => users.id),
    rowCount: integer('row_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    // JSON-encoded `{ rowIndex, code, field? }[]`. Stored as text so
    // SQLite (no native JSON column) keeps the call-site shape free
    // of side tables. Default is the empty array so the wire shape
    // is stable across success/failure outcomes.
    errorEnvelope: text('error_envelope').notNull().default(sql`'[]'`),
    // Original upload filename, persisted so the admin "import history"
    // surface can name the source CSV against each batch (Story #973
    // F1). Added by migration 0008 with a `''` default so rows that
    // pre-date the column survive; new inserts always carry a non-
    // empty value via the `CsvImportCommitInputSchema.fileName` field.
    fileName: text('file_name').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    // Load-bearing for the admin list query: `scopedDb` prefixes
    // every read with `where org_id = :actor_org_id`. Without this
    // index the list endpoint would scan the entire table.
    orgIdIdx: index('csv_import_batches_org_id_idx').on(table.orgId),
  }),
);

export type CsvImportBatch = typeof csvImportBatches.$inferSelect;
export type NewCsvImportBatch = typeof csvImportBatches.$inferInsert;
