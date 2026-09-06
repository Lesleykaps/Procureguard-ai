CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`records_scanned` integer NOT NULL,
	`flagged_count` integer NOT NULL,
	`mean_risk` real NOT NULL,
	`max_risk` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_scan_runs_created_at` ON `scan_runs` (`created_at`);