-- Migration 0002 — org / team graph (Epic #9 / Story #609)
--
-- Additive schema changes for the multi-tenant data model:
--   1. organizations.organization_type — required enum column. Added
--      with a temporary default of 'CLUB' so the ALTER is non-blocking on
--      any rows that may exist, then the default is stripped via a
--      table-rebuild so future inserts must specify the type explicitly
--      (the Drizzle schema does not declare a default — see
--      packages/shared/src/db/schema/organizations.ts).
--   2. teams.deleted_at — nullable timestamp for soft-delete +
--      30-day recovery semantics.
--   3. coach_assignments — N:N join between teams and coach users,
--      with denormalized org_id for query-layer scoping.
--   4. athlete_memberships — N:N join between teams and athlete users,
--      mirrored shape.
--
-- Indexes on (org_id, team_id) and (org_id, <user>_id) match the access
-- pattern of the scopedDb(actor) helper (Story #607) which prefixes every
-- read with `where org_id = :actor_org_id`.
--
-- Cross-tenant integrity for the two new join tables is enforced by
-- CHECK triggers because SQLite cannot express the dual-column FK
-- constraint cleanly. The triggers fire on INSERT and UPDATE OF org_id /
-- team_id / <user>_id and ABORT the statement when the assignment's
-- org_id does not match the team's org_id or the user's org_id. The
-- scopedDb helper also enforces this in code on every write.

-- 1. organizations.organization_type — additive with temporary default
ALTER TABLE `organizations` ADD COLUMN `organization_type` text NOT NULL DEFAULT 'CLUB';--> statement-breakpoint

-- Backfill any pre-existing rows to 'CLUB' (no-op on a fresh database;
-- explicit so the intent is auditable in migration history).
UPDATE `organizations` SET `organization_type` = 'CLUB' WHERE `organization_type` IS NULL;--> statement-breakpoint

-- Strip the default so future inserts must specify organization_type.
-- SQLite has no ALTER COLUMN DROP DEFAULT, so rebuild the table per the
-- canonical 12-step ALTER recipe at sqlite.org/lang_altertable.html#7.
-- The PRAGMA foreign_keys=OFF / foreign_key_check / foreign_keys=ON
-- wrap is REQUIRED: with FKs enforced the `DROP TABLE organizations`
-- below performs an implicit DELETE that fires FK enforcement against
-- every row in users.org_id and teams.org_id, which would otherwise
-- abort the migration on any database that already has org membership.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`organization_type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_organizations` (`id`, `name`, `organization_type`, `created_at`, `updated_at`)
SELECT `id`, `name`, `organization_type`, `created_at`, `updated_at` FROM `organizations`;--> statement-breakpoint
DROP TABLE `organizations`;--> statement-breakpoint
ALTER TABLE `__new_organizations` RENAME TO `organizations`;--> statement-breakpoint
-- foreign_key_check catches any genuinely-bad FK rows that snuck in
-- under the OFF window; re-enabling enforcement without the check would
-- silently authorize bad data.
PRAGMA foreign_key_check;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint

-- 2. teams.deleted_at — nullable soft-delete timestamp
ALTER TABLE `teams` ADD COLUMN `deleted_at` integer;--> statement-breakpoint

-- 3. coach_assignments — N:N join between teams and coach users
CREATE TABLE `coach_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`team_id` text NOT NULL,
	`coach_user_id` text NOT NULL,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coach_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `coach_assignments_org_team_idx` ON `coach_assignments` (`org_id`,`team_id`);--> statement-breakpoint
CREATE INDEX `coach_assignments_org_coach_idx` ON `coach_assignments` (`org_id`,`coach_user_id`);--> statement-breakpoint

-- Cross-tenant integrity trigger for coach_assignments — ABORT on
-- INSERT if the row's org_id does not match the team's or the coach
-- user's org_id.
CREATE TRIGGER `coach_assignments_cross_tenant_insert_check`
BEFORE INSERT ON `coach_assignments`
FOR EACH ROW
BEGIN
	SELECT CASE
		WHEN (SELECT `org_id` FROM `teams` WHERE `id` = NEW.`team_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'coach_assignments.org_id does not match teams.org_id')
		WHEN (SELECT `org_id` FROM `users` WHERE `id` = NEW.`coach_user_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'coach_assignments.org_id does not match users.org_id')
	END;
END;--> statement-breakpoint

CREATE TRIGGER `coach_assignments_cross_tenant_update_check`
BEFORE UPDATE OF `org_id`, `team_id`, `coach_user_id` ON `coach_assignments`
FOR EACH ROW
BEGIN
	SELECT CASE
		WHEN (SELECT `org_id` FROM `teams` WHERE `id` = NEW.`team_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'coach_assignments.org_id does not match teams.org_id')
		WHEN (SELECT `org_id` FROM `users` WHERE `id` = NEW.`coach_user_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'coach_assignments.org_id does not match users.org_id')
	END;
END;--> statement-breakpoint

-- 4. athlete_memberships — N:N join between teams and athlete users
CREATE TABLE `athlete_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`team_id` text NOT NULL,
	`athlete_user_id` text NOT NULL,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`athlete_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `athlete_memberships_org_team_idx` ON `athlete_memberships` (`org_id`,`team_id`);--> statement-breakpoint
CREATE INDEX `athlete_memberships_org_athlete_idx` ON `athlete_memberships` (`org_id`,`athlete_user_id`);--> statement-breakpoint

-- Cross-tenant integrity trigger for athlete_memberships — same
-- pattern as coach_assignments.
CREATE TRIGGER `athlete_memberships_cross_tenant_insert_check`
BEFORE INSERT ON `athlete_memberships`
FOR EACH ROW
BEGIN
	SELECT CASE
		WHEN (SELECT `org_id` FROM `teams` WHERE `id` = NEW.`team_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'athlete_memberships.org_id does not match teams.org_id')
		WHEN (SELECT `org_id` FROM `users` WHERE `id` = NEW.`athlete_user_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'athlete_memberships.org_id does not match users.org_id')
	END;
END;--> statement-breakpoint

CREATE TRIGGER `athlete_memberships_cross_tenant_update_check`
BEFORE UPDATE OF `org_id`, `team_id`, `athlete_user_id` ON `athlete_memberships`
FOR EACH ROW
BEGIN
	SELECT CASE
		WHEN (SELECT `org_id` FROM `teams` WHERE `id` = NEW.`team_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'athlete_memberships.org_id does not match teams.org_id')
		WHEN (SELECT `org_id` FROM `users` WHERE `id` = NEW.`athlete_user_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'athlete_memberships.org_id does not match users.org_id')
	END;
END;
