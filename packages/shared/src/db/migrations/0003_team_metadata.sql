-- Migration 0003 — team metadata (Epic #10 / Story #657 / Task #678)
--
-- Adds the four team-management columns the org-admin Team CRUD surface
-- requires:
--
--   1. teams.sport       — required text. Free-form for now (e.g.
--                          "Volleyball", "Basketball"); a future Epic
--                          may tighten to an enum once the canonical
--                          sport taxonomy lands.
--   2. teams.season      — required text. Season identifier (e.g.
--                          "Fall 2026"). Free-form by design.
--   3. teams.age_group   — required text. Age-band identifier (e.g.
--                          "U14", "Varsity"). Free-form for the same
--                          reason as season.
--   4. teams.archived_at — nullable timestamp. Set to `now()` to
--                          archive a team; cleared to restore.
--                          Independent of the existing `deleted_at`
--                          soft-delete column (which carries 30-day
--                          hard-delete semantics from Epic #9 /
--                          Story #605).
--
-- The three required columns carry an empty-string DB default so legacy
-- fixtures (Epic #9 cross-tenant tests, etc.) that insert teams without
-- these fields keep working. Real callers are gated by the Zod schema
-- at `@repo/shared/schemas/admin/teams` (POST/PATCH min(1) on each
-- field) — the empty-string default is unreachable from production
-- writes.

ALTER TABLE `teams` ADD COLUMN `sport` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `teams` ADD COLUMN `season` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `teams` ADD COLUMN `age_group` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `teams` ADD COLUMN `archived_at` integer;--> statement-breakpoint
