-- Migration 0011 — organizations.organization_type DB-layer CHECK (Story #642)
--
-- Hardens the `organizations.organization_type` enum at the persistence
-- boundary. The column was introduced by migration 0002 as a plain
-- `text NOT NULL` and the enum (CLUB | HIGH_SCHOOL | COLLEGE) was enforced
-- only by the Drizzle TypeScript hint
-- (`text('organization_type', { enum: ORGANIZATION_TYPES })` in
-- packages/shared/src/db/schema/organizations.ts) — a compile-time guard
-- the database itself does not honour. An insert of an arbitrary string
-- (e.g. 'UNIVERSITY') therefore persists. This migration adds the
-- equivalent DB-layer constraint
-- `CHECK ("organization_type" IN ('CLUB','HIGH_SCHOOL','COLLEGE'))` so the
-- TypeScript enum becomes load-bearing at the persistence layer.
--
-- This is defense-in-depth: no current ingress path writes
-- organization_type from untrusted input (the seed fixture hard-codes
-- 'CLUB'; the PATCH /api/v1/admin/org body schema does not accept the
-- field). The constraint hardens the boundary ahead of the future
-- org-creation/edit surface. Reference pattern: the
-- `legal_documents_kind_check` CHECK declared inline on the
-- `legal_documents` table in migration 0001_onboarding_schema.sql.
--
-- SQLite has no `ALTER TABLE ... ADD CONSTRAINT` / `ADD CHECK`, so adding
-- the constraint requires a full table rebuild per the canonical 12-step
-- ALTER recipe at sqlite.org/lang_altertable.html#otheralter — the same
-- recipe migration 0002 used to strip the temporary default.
--
-- The PRAGMA foreign_keys=OFF / foreign_key_check / foreign_keys=ON wrap
-- is REQUIRED: `organizations` is an FK target for `users.org_id` and
-- `teams.org_id` (and the org_id columns on coach_assignments /
-- athlete_memberships). With FK enforcement on, the `DROP TABLE
-- organizations` below performs an implicit DELETE that fires FK
-- enforcement against every referencing row, which would abort the
-- migration on any database that already holds org membership. Disabling
-- enforcement for the rebuild, then re-running `PRAGMA foreign_key_check`
-- before re-enabling, preserves integrity without aborting on the
-- transient drop.
--
-- The rebuilt table preserves every existing column verbatim — `id`,
-- `name`, `organization_type`, `logo_r2_key` and `primary_color_hex`
-- (added by 0004_org_branding.sql), `created_at`, `updated_at` — and
-- copies all existing rows across. Additive and idempotent in effect:
-- it changes the table's constraint surface only, not its data.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization_type` text NOT NULL,
	`logo_r2_key` text,
	`primary_color_hex` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "organizations_organization_type_check" CHECK("organization_type" IN ('CLUB', 'HIGH_SCHOOL', 'COLLEGE'))
);--> statement-breakpoint
INSERT INTO `__new_organizations` (`id`, `name`, `organization_type`, `logo_r2_key`, `primary_color_hex`, `created_at`, `updated_at`)
SELECT `id`, `name`, `organization_type`, `logo_r2_key`, `primary_color_hex`, `created_at`, `updated_at` FROM `organizations`;--> statement-breakpoint
DROP TABLE `organizations`;--> statement-breakpoint
ALTER TABLE `__new_organizations` RENAME TO `organizations`;--> statement-breakpoint
-- foreign_key_check catches any genuinely-bad FK rows that snuck in under
-- the OFF window; re-enabling enforcement without the check would
-- silently authorize bad data.
PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA foreign_keys=ON;
