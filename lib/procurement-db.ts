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
  const normalized = pattern.toLowerCase();
  let risk = amount >= 50000 ? 72 : amount >= 20000 ? 58 : amount >= 10000 ? 42 : 24;
  if (normalized.includes('duplicate')) risk += 28;
  else if (normalized.includes('split')) risk += 24;
  else if (normalized.includes('overbill')) risk += 22;
  else if (normalized.includes('conflict')) risk += 20;
  else if (normalized.includes('single')) risk += 16;
  else if (normalized.includes('normal')) risk -= 10;
  return Math.max(5, Math.min(99, Math.round(risk)));
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
  statements.push(env.DB.prepare(`INSERT INTO model_snapshots (id, name, version, accuracy, false_positive_rate, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind('model-xgboost-v1', 'XGBoost Ensemble', 'v1.0.0', 96.4, 7.8, 1, now));
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
