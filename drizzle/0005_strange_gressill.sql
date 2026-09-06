ALTER TABLE `scan_runs` ADD `high_risk_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `medium_risk_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `low_risk_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_runs` ADD `missing_feature_count` integer DEFAULT 0 NOT NULL;