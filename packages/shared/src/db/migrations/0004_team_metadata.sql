ALTER TABLE `teams` ADD `sport` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `season` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `age_group` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `teams` ADD `archived_at` integer;