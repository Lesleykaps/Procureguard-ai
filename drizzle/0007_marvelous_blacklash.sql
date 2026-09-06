CREATE TABLE `model_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`artifact_json` text NOT NULL,
	`metrics_json` text NOT NULL,
	`source` text NOT NULL,
	`submitted_by` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`activated_by` text,
	`activated_at` text,
	`decision_note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_model_releases_status` ON `model_releases` (`status`);--> statement-breakpoint
CREATE INDEX `idx_model_releases_created_at` ON `model_releases` (`created_at`);