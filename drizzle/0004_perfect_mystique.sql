CREATE TABLE `review_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`decision` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_review_decisions_transaction_id` ON `review_decisions` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_review_decisions_created_at` ON `review_decisions` (`created_at`);