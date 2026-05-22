CREATE TABLE `csv_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`imported_by_user_id` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`error_envelope` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `csv_import_batches_org_id_idx` ON `csv_import_batches` (`org_id`);