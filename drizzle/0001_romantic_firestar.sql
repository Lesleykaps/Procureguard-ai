CREATE INDEX `idx_alerts_status` ON `alerts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_alerts_transaction_id` ON `alerts` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_transactions_created_at` ON `procurement_transactions` (`created_at`);