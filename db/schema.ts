import { integer, real, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull(),
  createdAt: text('created_at').notNull(),
});

export const procurementTransactions = sqliteTable('procurement_transactions', {
  id: text('id').primaryKey(),
  supplier: text('supplier').notNull(),
  amount: real('amount').notNull(),
  pattern: text('pattern').notNull(),
  riskScore: integer('risk_score').notNull(),
  status: text('status').notNull(),
  reason: text('reason').notNull(),
  sourceFile: text('source_file'),
  modelFeaturesJson: text('model_features_json'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  createdAtIdx: index('idx_transactions_created_at').on(table.createdAt),
}));

export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull(),
  riskLevel: text('risk_level').notNull(),
  status: text('status').notNull(),
  assignedTo: text('assigned_to'),
  createdAt: text('created_at').notNull(),
  reviewedAt: text('reviewed_at'),
}, (table) => ({
  statusIdx: index('idx_alerts_status').on(table.status),
  transactionIdx: index('idx_alerts_transaction_id').on(table.transactionId),
}));

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  eventType: text('event_type').notNull(),
  message: text('message').notNull(),
  entityId: text('entity_id'),
  createdAt: text('created_at').notNull(),
});

export const modelSnapshots = sqliteTable('model_snapshots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  accuracy: real('accuracy').notNull(),
  falsePositiveRate: real('false_positive_rate').notNull(),
  isApproved: integer('is_approved', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const scanRuns = sqliteTable('scan_runs', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  recordsScanned: integer('records_scanned').notNull(),
  flaggedCount: integer('flagged_count').notNull(),
  meanRisk: real('mean_risk').notNull(),
  maxRisk: integer('max_risk').notNull(),
  durationMs: integer('duration_ms').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  createdAtIdx: index('idx_scan_runs_created_at').on(table.createdAt),
}));

export const reviewDecisions = sqliteTable('review_decisions', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id').notNull(),
  actorId: text('actor_id').notNull(),
  decision: text('decision').notNull(),
  note: text('note'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  transactionIdx: index('idx_review_decisions_transaction_id').on(table.transactionId),
  createdAtIdx: index('idx_review_decisions_created_at').on(table.createdAt),
}));
