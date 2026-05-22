/**
 * @repo/shared/db/schema/organizations — production Drizzle table.
 *
 * Skeleton table introduced by Epic #7 / Story #330 to serve as the FK
 * target for `users.org_id` and `teams.org_id`. Epic #9 / Story #605
 * extended it with the `organization_type` enum so the rest of the
 * platform can route around school/college context from day one. Full
 * schema (members, invitations, billing, etc.) is owned by later feature
 * Epics.
 *
 * Columns intentionally kept minimal — extend only via additive
 * migrations from the owning Epic.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Closed enum for `organizations.organization_type`. Sourced from the
 * Epic #9 PRD / Tech Spec § Data Models. Update the migration alongside
 * any change to this list.
 */
export const ORGANIZATION_TYPES = ['CLUB', 'HIGH_SCHOOL', 'COLLEGE'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  organizationType: text('organization_type', {
    enum: ORGANIZATION_TYPES,
  }).notNull(),
  // Story #656: branding columns persisted by the org-config page.
  // Both are nullable and have no default — orgs may be created before
  // a logo is uploaded or a brand colour is chosen.
  logoR2Key: text('logo_r2_key'),
  primaryColorHex: text('primary_color_hex'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
