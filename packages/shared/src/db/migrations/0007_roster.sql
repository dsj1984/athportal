-- Migration 0007 — roster data model (Epic #11 / Story #910 / Task #914)
--
-- Adds the two new persisted entities the coach roster surface requires:
--
--   1. `roster_entry` — one row per athlete-on-this-team. Created when a
--      roster invite is accepted; soft-deleted via `ended_at` when the
--      coach removes the athlete. Carries the team-scoped attributes
--      (`jersey_number`, `primary_position`) the Epic introduces.
--   2. `roster_invite` — one row per outstanding coach-issued invitation.
--      Distinct from `invitations` (Clerk-mediated org-admin invites)
--      per Tech Spec #906 §Overview — roster invites operate on
--      already-onboarded athlete identities and produce
--      `athlete_memberships` + `roster_entry` on accept.
--
-- Both tables follow the cross-tenant pattern established by migration
-- 0002 for `coach_assignments` / `athlete_memberships`: denormalised
-- `org_id` for the `scopedDb(actor)` predicate, indexed FKs to
-- `organizations` / `teams` / `users`, and CHECK constraints on the
-- columns whose grammar the Zod boundary schemas pin
-- (`roster_entry.jersey_number` matches `^[0-9]{1,3}$`,
-- `roster_invite.email` matches a simple email shape).
--
-- Lazy-expired contract for `roster_invite.status`: rows stay `pending`
-- until a read or accept attempt finds `expires_at < now()`; at that
-- point the row is updated to `expired` in the same transaction. The
-- migration therefore declares no nightly cron — `status` is just a
-- text column with a default of `'pending'`.

-- 1. roster_entry — athlete-on-team join with team-scoped attributes
CREATE TABLE `roster_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`team_id` text NOT NULL,
	`athlete_user_id` text NOT NULL,
	`jersey_number` text,
	`primary_position` text,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`athlete_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	-- Pinned grammar for jersey_number — keeps leading zeros and "00"
	-- representable while refusing alphabetics. Mirrors the Zod
	-- pattern in @repo/shared/schemas/coach/roster.ts.
	CHECK (`jersey_number` IS NULL OR `jersey_number` GLOB '[0-9]' OR `jersey_number` GLOB '[0-9][0-9]' OR `jersey_number` GLOB '[0-9][0-9][0-9]'),
	CHECK (`primary_position` IS NULL OR length(`primary_position`) <= 32)
);--> statement-breakpoint

CREATE INDEX `roster_entry_org_team_idx` ON `roster_entry` (`org_id`,`team_id`);--> statement-breakpoint
CREATE INDEX `roster_entry_team_ended_idx` ON `roster_entry` (`team_id`,`ended_at`);--> statement-breakpoint
-- Partial unique index: an athlete is on a team at most once while
-- the membership is active. After `ended_at` is set, the pair can be
-- reused.
CREATE UNIQUE INDEX `roster_entry_team_athlete_active_unique`
	ON `roster_entry` (`team_id`,`athlete_user_id`)
	WHERE `ended_at` IS NULL;--> statement-breakpoint

-- Cross-tenant integrity trigger for roster_entry — ABORT on INSERT
-- if the row's org_id does not match the team's or the athlete user's
-- org_id. Mirrors the trigger pattern established by migration 0002.
CREATE TRIGGER `roster_entry_cross_tenant_insert_check`
BEFORE INSERT ON `roster_entry`
FOR EACH ROW
BEGIN
	SELECT CASE
		WHEN (SELECT `org_id` FROM `teams` WHERE `id` = NEW.`team_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'roster_entry.org_id does not match teams.org_id')
		WHEN (SELECT `org_id` FROM `users` WHERE `id` = NEW.`athlete_user_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'roster_entry.org_id does not match users.org_id')
	END;
END;--> statement-breakpoint

CREATE TRIGGER `roster_entry_cross_tenant_update_check`
BEFORE UPDATE OF `org_id`, `team_id`, `athlete_user_id` ON `roster_entry`
FOR EACH ROW
BEGIN
	SELECT CASE
		WHEN (SELECT `org_id` FROM `teams` WHERE `id` = NEW.`team_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'roster_entry.org_id does not match teams.org_id')
		WHEN (SELECT `org_id` FROM `users` WHERE `id` = NEW.`athlete_user_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'roster_entry.org_id does not match users.org_id')
	END;
END;--> statement-breakpoint

-- 2. roster_invite — outstanding coach-issued invitation
CREATE TABLE `roster_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`team_id` text NOT NULL,
	`email` text NOT NULL,
	`first_name` text,
	`last_name` text,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`declined_at` integer,
	`invited_by_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	-- Lowercase-on-insert is enforced application-side by the Zod
	-- schema; the CHECK below pins the minimal email grammar so any
	-- path that bypasses the Zod parser still refuses obvious junk.
	CHECK (`email` LIKE '%_@_%.__%' AND length(`email`) <= 254),
	CHECK (`status` IN ('pending','accepted','declined','expired','revoked'))
);--> statement-breakpoint

CREATE INDEX `roster_invite_org_id_idx` ON `roster_invite` (`org_id`);--> statement-breakpoint
CREATE INDEX `roster_invite_team_status_idx` ON `roster_invite` (`team_id`,`status`);--> statement-breakpoint
CREATE INDEX `roster_invite_email_idx` ON `roster_invite` (`email`);--> statement-breakpoint
-- token_hash is the only authorization on the public accept route;
-- a unique index makes the constant-time lookup an indexed point read
-- and refuses any duplicate-hash insert.
CREATE UNIQUE INDEX `roster_invite_token_hash_unique` ON `roster_invite` (`token_hash`);--> statement-breakpoint

-- Cross-tenant integrity trigger for roster_invite — ABORT on INSERT
-- if the row's org_id does not match the team's or the inviting
-- user's org_id.
CREATE TRIGGER `roster_invite_cross_tenant_insert_check`
BEFORE INSERT ON `roster_invite`
FOR EACH ROW
BEGIN
	SELECT CASE
		WHEN (SELECT `org_id` FROM `teams` WHERE `id` = NEW.`team_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'roster_invite.org_id does not match teams.org_id')
		WHEN (SELECT `org_id` FROM `users` WHERE `id` = NEW.`invited_by_user_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'roster_invite.org_id does not match users.org_id')
	END;
END;--> statement-breakpoint

CREATE TRIGGER `roster_invite_cross_tenant_update_check`
BEFORE UPDATE OF `org_id`, `team_id`, `invited_by_user_id` ON `roster_invite`
FOR EACH ROW
BEGIN
	SELECT CASE
		WHEN (SELECT `org_id` FROM `teams` WHERE `id` = NEW.`team_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'roster_invite.org_id does not match teams.org_id')
		WHEN (SELECT `org_id` FROM `users` WHERE `id` = NEW.`invited_by_user_id`) IS NOT NEW.`org_id`
			THEN RAISE(ABORT, 'roster_invite.org_id does not match users.org_id')
	END;
END;
