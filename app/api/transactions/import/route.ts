import { actorFromRequest, addAuditEvent, parseCsv, riskLevel, scoreTransaction } from '../../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'Choose a CSV file to import.' }, { status: 400 });
    if (file.size > 2_000_000) return Response.json({ error: 'CSV files must be smaller than 2 MB.' }, { status: 400 });
    const records = parseCsv(await file.text());
    const now = new Date().toISOString();
    const statements = [];
    for (const record of records) {
      const risk = scoreTransaction(record.pattern, record.amount, record.modelFeatures);
      const status = 'Open';
      const reason = `Scored from ${record.pattern.toLowerCase()} signal and a $${record.amount.toLocaleString()} procurement value.`;
      statements.push(env.DB.prepare(`INSERT OR REPLACE INTO procurement_transactions (id, supplier, amount, pattern, risk_score, status, reason, source_file, model_features_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(record.id, record.supplier, record.amount, record.pattern, risk, status, reason, file.name, JSON.stringify(record.modelFeatures), now));
      if (risk >= 55) {
        statements.push(env.DB.prepare(`INSERT OR REPLACE INTO alerts (id, transaction_id, risk_level, status, assigned_to, created_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(`ALT-${record.id}`, record.id, riskLevel(risk), status, null, now, null));
      }
    }
    await env.DB.batch(statements);
    await addAuditEvent(actorFromRequest(request), 'import', `${records.length} procurement records imported from ${file.name}.`);
    return Response.json({ imported: records.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to import CSV.' }, { status: 400 });
  }
}
