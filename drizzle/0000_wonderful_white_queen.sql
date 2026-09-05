CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`risk_level` text NOT NULL,
	`status` text NOT NULL,
	`assigned_to` text,
	`created_at` text NOT NULL,
	`reviewed_at` text
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`event_type` text NOT NULL,
	`message` text NOT NULL,
	`entity_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`accuracy` real NOT NULL,
	`false_positive_rate` real NOT NULL,
	`is_approved` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `procurement_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier` text NOT NULL,
	`amount` real NOT NULL,
	`pattern` text NOT NULL,
	`risk_score` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text NOT NULL,
	`source_file` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);