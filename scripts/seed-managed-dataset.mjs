import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

function envValue(text, key) {
  return text.split(/\r?\n/).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
}

function parseCsvLine(line) {
  const fields = []; let value = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; }
    else if (character === ',' && !quoted) { fields.push(value); value = ''; }
    else value += character;
  }
  fields.push(value);
  return fields;
}

const config = await readFile('.env.local', 'utf8');
const url = envValue(config, 'SUPABASE_URL');
const secret = envValue(config, 'SUPABASE_SECRET_KEY');
if (!url || !secret?.startsWith('sb_secret_')) throw new Error('SUPABASE_URL and a server-only SUPABASE_SECRET_KEY are required.');
const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const [header, ...lines] = (await readFile('ml/synthetic_procurement_transactions.csv', 'utf8')).trim().split(/\r?\n/);
const columns = parseCsvLine(header);
const rows = lines.map((line) => Object.fromEntries(columns.map((column, index) => [column, parseCsvLine(line)[index] ?? ''])));

const number = (value) => Number(value) || 0;
const featureVector = (row) => {
  const amount = number(row.amount_usd); const contract = Math.max(number(row.contract_amount_usd), 1);
  return [Math.min(1, Math.log1p(amount) / Math.log1p(180000)), Math.min(1, amount / contract / 2), 1 - Math.min(1, Math.max(0, number(row.bidder_count) - 1) / 7), 1 - Math.min(1, Math.max(0, number(row.bidding_window_days) - 1) / 44), Math.min(1, Math.max(0, number(row.price_deviation_pct) + 10) / 78), Math.min(1, Math.max(0, number(row.invoice_duplicate_count) - 1) / 3), Math.min(1, number(row.invoices_last_30d) / 26), number(row.approval_override_count) ? 1 : 0, number(row.approver_vendor_domain_match) ? 1 : 0, Math.min(1, number(row.split_group_total_usd) / Math.max(amount * 7, 1)), 1 - Math.min(1, Math.max(0, number(row.supplier_age_days) - 30) / 4170), Math.min(1, number(row.related_supplier_count) / 4)];
};

const transactions = rows.map((row) => {
  const fraudulent = row.label_fraud === '1';
  const risk = fraudulent ? 75 + Math.min(24, Math.round(Math.abs(number(row.price_deviation_pct)) / 4 + number(row.invoice_duplicate_count) * 3 + number(row.approval_override_count) * 4)) : Math.min(45, 8 + Math.round(Math.abs(number(row.price_deviation_pct)) / 3));
  return { id: row.transaction_id, supplier: row.supplier_name, amount: number(row.amount_usd), pattern: row.pattern || 'Normal purchase', risk_score: risk, status: 'Open', reason: row.label_reason || 'Synthetic procurement record generated for dissertation evaluation.', source_file: 'synthetic_procurement_transactions.csv', model_features_json: featureVector(row), created_at: row.created_at };
});

const startOffset = Math.max(0, Number(process.env.SEED_START_OFFSET ?? 0));
for (let offset = startOffset; offset < transactions.length; offset += 500) {
  const batch = transactions.slice(offset, offset + 500);
  const saved = await supabase.from('procurement_transactions').upsert(batch, { onConflict: 'id' });
  if (saved.error) throw saved.error;
  const alerts = batch.filter((record) => record.risk_score >= 55).map((record) => ({ id: `ALT-${record.id}`, transaction_id: record.id, risk_level: record.risk_score >= 80 ? 'High' : 'Medium', status: 'Open', assigned_to: null, reviewed_at: null, created_at: record.created_at }));
  if (alerts.length) { const savedAlerts = await supabase.from('alerts').upsert(alerts, { onConflict: 'id' }); if (savedAlerts.error) throw savedAlerts.error; }
  process.stdout.write(`Seeded ${Math.min(offset + batch.length, transactions.length)}/${transactions.length}\n`);
}

const audit = await supabase.from('audit_events').insert({ id: `AUD-${crypto.randomUUID()}`, actor_id: 'system', event_type: 'synthetic_dataset_seed', message: `Loaded ${transactions.length} synthetic procurement records for dissertation evaluation.`, entity_id: null, created_at: new Date().toISOString() });
if (audit.error) throw audit.error;
