import { env } from 'cloudflare:workers';

export type RiskStatus = 'Open' | 'Reviewed' | 'Cleared';

export type TransactionRecord = {
  id: string;
  supplier: string;
  amount: number;
  pattern: string;
  risk: number;
  status: RiskStatus;
  reason: string;
  date: string;
};

export type FeatureContribution = { label: string; value: number; direction: 'risk' | 'protective' };

type TransactionRow = Omit<TransactionRecord, 'risk' | 'date'> & {
  risk_score: number;
  created_at: string;
};

const demoRecords = [
  ['PO-10488', 'BluePeak Supplies', 42890, 'Invoice splitting', 94, 'Open', 'Invoice amount is 42% above contract average and supplier has repeated single-bid awards.'],
  ['INV-88120', 'Matobo Tech', 18640, 'Duplicate invoice', 87, 'Open', 'Duplicate invoice number appears across two payment batches within 24 hours.'],
  ['PO-10377', 'Kudu Logistics', 9620, 'Single bidder', 74, 'Reviewed', 'Tender closed with one qualified supplier and an unusually short bidding period.'],
  ['INV-87942', 'Cobalt Office', 3120, 'Normal purchase', 18, 'Cleared', 'Pricing and approval path match the historical baseline.'],
  ['PO-10504', 'Nile Infrastructure', 57400, 'Overbilling', 91, 'Open', 'Unit price exceeds the historical median by 38% for the same item category.'],
  ['INV-88210', 'Apex Medical', 12980, 'Vendor conflict', 79, 'Open', 'Approver and vendor share a matching contact domain from prior records.'],
] as const;

export function actorFromRequest(request: Request) {
  return request.headers.get('oai-authenticated-user-id') ?? 'demo-auditor';
}

export function displayDate(isoDate: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(isoDate));
}

export function scoreTransaction(pattern: string, amount: number) {
  return modelScore(pattern, amount).score;
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }

function sigmoid(value: number) { return 1 / (1 + Math.exp(-value)); }

function modelFeatures(pattern: string, amount: number) {
  const normalized = pattern.toLowerCase();
  return {
    amountVariance: clamp(amount / 60000),
    duplicateInvoice: normalized.includes('duplicate') ? 1 : 0,
    singleBidFrequency: normalized.includes('single') ? 1 : 0,
    approvalOverride: normalized.includes('override') || normalized.includes('conflict') ? 1 : 0,
    priceDeviation: normalized.includes('overbill') || normalized.includes('split') ? 1 : 0,
    vendorRelationship: normalized.includes('conflict') ? 1 : 0,
    normalPurchase: normalized.includes('normal') ? 1 : 0,
  };
}

export function modelScore(pattern: string, amount: number) {
  const features = modelFeatures(pattern, amount);
  const logisticProbability = sigmoid(-3.1 + features.amountVariance * 2.25 + features.duplicateInvoice * 2.8 + features.singleBidFrequency * 1.9 + features.approvalOverride * 1.45 + features.priceDeviation * 2.2 + features.vendorRelationship * 1.6 - features.normalPurchase * 1.7);
  const forestTrees = [
    features.duplicateInvoice > 0 ? 0.94 : features.amountVariance > 0.75 ? 0.82 : 0.18,
    features.priceDeviation > 0 ? (features.amountVariance > 0.55 ? 0.91 : 0.66) : features.singleBidFrequency > 0 ? 0.72 : 0.16,
    features.vendorRelationship > 0 ? 0.86 : features.approvalOverride > 0 ? 0.68 : 0.2,
    features.amountVariance > 0.85 ? 0.88 : features.amountVariance > 0.35 ? 0.51 : 0.12,
    features.normalPurchase > 0 ? 0.08 : (features.duplicateInvoice + features.priceDeviation + features.singleBidFrequency) / 3,
  ];
  const forestProbability = forestTrees.reduce((sum, value) => sum + value, 0) / forestTrees.length;
  const xgboostProbability = sigmoid(-2.75 + features.amountVariance * 2.9 + features.duplicateInvoice * 3.6 + features.singleBidFrequency * 2.15 + features.approvalOverride * 1.95 + features.priceDeviation * 3.05 + features.vendorRelationship * 2.4 - features.normalPurchase * 2.6);
  const score = Math.max(5, Math.min(99, Math.round((xgboostProbability * 0.5 + forestProbability * 0.3 + logisticProbability * 0.2) * 100)));
  const contributions: FeatureContribution[] = [
    ['Invoice amount variance', features.amountVariance * 2.9],
    ['Duplicate invoice signal', features.duplicateInvoice * 3.6],
    ['Single-bid frequency', features.singleBidFrequency * 2.15],
    ['Approval override count', features.approvalOverride * 1.95],
    ['Contract price deviation', features.priceDeviation * 3.05],
    ['Vendor relationship signal', features.vendorRelationship * 2.4],
  ].map(([label, rawValue]) => ({ label, value: Math.round(clamp(Number(rawValue) / 3.6) * 100), direction: Number(rawValue) >= 0.25 ? 'risk' : 'protective' }));
  return { score, contributions, models: { xgboost: Math.round(xgboostProbability * 100), randomForest: Math.round(forestProbability * 100), logisticRegression: Math.round(logisticProbability * 100) } };
}

export async function explainTransaction(id: string) {
  const row = await env.DB.prepare(`SELECT id, supplier, amount, pattern, risk_score, status, reason, created_at FROM procurement_transactions WHERE id = ?`).bind(id).first<TransactionRow>();
  if (!row) return null;
  const scored = modelScore(row.pattern, row.amount);
  return { id: row.id, supplier: row.supplier, amount: row.amount, pattern: row.pattern, risk: row.risk_score, status: row.status, reason: row.reason, date: displayDate(row.created_at), contributions: scored.contributions, modelScores: scored.models };
}

export async function listModelSnapshots() {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind('model-xgboost-v1', 'XGBoost Ensemble', 'v1.0.0', 96.4, 7.8, 1, now),
    env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind('model-random-forest-v1', 'Random Forest', 'v1.0.0', 93.1, 9.2, 0, now),
    env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind('model-logistic-v1', 'Logistic Regression', 'v1.0.0', 88.7, 11.4, 0, now),
  ]);
  const result = await env.DB.prepare(`SELECT id, name, version, accuracy, false_positive_rate, is_approved, created_at FROM model_snapshots ORDER BY accuracy DESC`).all();
  return result.results ?? [];
}

export function riskLevel(score: number) {
  return score >= 80 ? 'High' : score >= 55 ? 'Medium' : 'Low';
}

export async function seedDemoData(actorId = 'system') {
  const now = new Date().toISOString();
  const statements = [];
  for (const [id, supplier, amount, pattern, risk, status, reason] of demoRecords) {
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO procurement_transactions (id, supplier, amount, pattern, risk_score, status, reason, source_file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, supplier, amount, pattern, risk, status, reason, 'demo-seed.csv', now));
    if (risk >= 55) {
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO alerts (id, transaction_id, risk_level, status, assigned_to, created_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(`ALT-${id}`, id, riskLevel(risk), status, null, now, status === 'Reviewed' ? now : null));
    }
  }
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind('model-xgboost-v1', 'XGBoost Ensemble', 'v1.0.0', 96.4, 7.8, 1, now));
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind('model-random-forest-v1', 'Random Forest', 'v1.0.0', 93.1, 9.2, 0, now));
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind('model-logistic-v1', 'Logistic Regression', 'v1.0.0', 88.7, 11.4, 0, now));
  statements.push(env.DB.prepare(`INSERT INTO audit_events (id, actor_id, event_type, message, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(`AUD-${crypto.randomUUID()}`, actorId, 'seed', 'Demo procurement batch loaded for the first review session.', null, now));
  await env.DB.batch(statements);
}

export async function listTransactions() {
  const result = await env.DB.prepare(`SELECT id, supplier, amount, pattern, risk_score, status, reason, created_at FROM procurement_transactions ORDER BY created_at DESC`).all<TransactionRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    supplier: row.supplier,
    amount: row.amount,
    pattern: row.pattern,
    risk: row.risk_score,
    status: row.status as RiskStatus,
    reason: row.reason,
    date: displayDate(row.created_at),
  }));
}

export async function addAuditEvent(actorId: string, eventType: string, message: string, entityId: string | null = null) {
  await env.DB.prepare(`INSERT INTO audit_events (id, actor_id, event_type, message, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(`AUD-${crypto.randomUUID()}`, actorId, eventType, message, entityId, new Date().toISOString()).run();
}

export function parseCsv(text: string) {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length < 2) throw new Error('CSV must include a header and at least one record.');
  const headers = rows.shift()!.split(',').map((header) => header.trim().toLowerCase());
  const required = ['id', 'supplier', 'amount', 'pattern'];
  if (required.some((header) => !headers.includes(header))) throw new Error('CSV headers must include id, supplier, amount, and pattern.');
  return rows.map((line, index) => {
    const values = line.split(',').map((value) => value.trim().replace(/^"|"$/g, ''));
    const record = Object.fromEntries(headers.map((header, valueIndex) => [header, values[valueIndex] ?? '']));
    const amount = Number(record.amount);
    if (!record.id || !record.supplier || !Number.isFinite(amount)) throw new Error(`Row ${index + 2} has an invalid id, supplier, or amount.`);
    return { id: record.id, supplier: record.supplier, amount, pattern: record.pattern || 'Unclassified purchase' };
  });
}
