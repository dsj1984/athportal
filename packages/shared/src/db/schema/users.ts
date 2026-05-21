/**
 * @repo/shared/db/schema/users — production Drizzle table.
 *
 * Production user model introduced by Epic #7 / Story #330.
 *
 * Loadbearing column: `clerk_subject_id` is UNIQUE and is the conflict
 * target for the JIT provisioning insert in `requireInternalUser`
 * (Tech Spec #318 §C). On first request from a never-before-seen Clerk
 * subject, the auth middleware performs:
 *
 *   INSERT INTO users (...) VALUES (...)
 *   ON CONFLICT(clerk_subject_id) DO NOTHING RETURNING *
 *
 * and re-selects on conflict. The UNIQUE index makes that race-free
 * under parallel first-touch.
 *
 * `role` is the enum used by `packages/shared/src/rbac/policy.ts`:
 *   `dev_admin` | `org_admin` | `team_admin` | `member`.
 *
 * `onboarded_at` drives the onboarding redirect in
 * `apps/web/src/middleware.ts`; `NULL` means "not yet onboarded".
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations } from './organizations';
import { teams } from './teams';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    clerkSubjectId: text('clerk_subject_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    orgId: text('org_id').references(() => organizations.id),
    teamId: text('team_id').references(() => teams.id),
    onboardedAt: integer('onboarded_at', { mode: 'timestamp' }),
    ageAttestedAt: integer('age_attested_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    clerkSubjectIdUnique: uniqueIndex('users_clerk_subject_id_unique').on(table.clerkSubjectId),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
