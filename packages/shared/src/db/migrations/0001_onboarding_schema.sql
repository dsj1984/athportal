CREATE TABLE `legal_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`version` text NOT NULL,
	`effective_at` integer NOT NULL,
	`body_url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "legal_documents_kind_check" CHECK("legal_documents"."kind" IN ('terms_of_service', 'privacy_policy'))
);
--> statement-breakpoint
CREATE INDEX `legal_documents_kind_effective_at_idx` ON `legal_documents` (`kind`,"effective_at" DESC);--> statement-breakpoint
CREATE TABLE `parent_athlete_links` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_user_id` text NOT NULL,
	`athlete_user_id` text NOT NULL,
	`established_via` text NOT NULL,
	`invite_token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`athlete_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `parent_athlete_links_pair_unique` ON `parent_athlete_links` (`parent_user_id`,`athlete_user_id`);--> statement-breakpoint
CREATE TABLE `user_legal_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`legal_document_id` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`legal_document_id`) REFERENCES `legal_documents`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_legal_agreements_user_document_unique` ON `user_legal_agreements` (`user_id`,`legal_document_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `age_attested_at` integer;