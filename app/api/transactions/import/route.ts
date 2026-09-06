import { addAuditEvent, getAuthenticatedActor, hasPermission, parseCsv, riskLevel, scoreTransaction } from '../../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:import')) return Response.json({ error: 'Your role cannot import procurement records.' }, { status: 403 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'Choose a CSV file to import.' }, { status: 400 });
    if (file.size > 2_000_000) return Response.json({ error: 'CSV files must be smaller than 2 MB.' }, { status: 400 });
    const records = parseCsv(await file.text());
    const seenIds = new Set<string>();
    const uniqueRecords = records.filter((record) => {
      if (seenIds.has(record.id)) return false;
      seenIds.add(record.id);
      return true;
    });
    const existingIds = new Set<string>();
    for (let start = 0; start < uniqueRecords.length; start += 500) {
      const chunk = uniqueRecords.slice(start, start + 500);
      const placeholders = chunk.map(() => '?').join(', ');
      const existing = await env.DB.prepare(`SELECT id FROM procurement_transactions WHERE id IN (${placeholders})`).bind(...chunk.map((record) => record.id)).all<{ id: string }>();
      for (const row of existing.results ?? []) existingIds.add(row.id);
    }
    const importableRecords = uniqueRecords.filter((record) => !existingIds.has(record.id));
    const duplicateCount = records.length - importableRecords.length;
    const now = new Date().toISOString();
    const statements = [];
    for (const record of importableRecords) {
      const risk = scoreTransaction(record.pattern, record.amount, record.modelFeatures);
      const status = 'Open';
      const reason = `Scored from ${record.pattern.toLowerCase()} signal and a $${record.amount.toLocaleString()} procurement value.`;
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO procurement_transactions (id, supplier, amount, pattern, risk_score, status, reason, source_file, model_features_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(record.id, record.supplier, record.amount, record.pattern, risk, status, reason, file.name, JSON.stringify(record.modelFeatures), now));
      if (risk >= 55) {
        statements.push(env.DB.prepare(`INSERT OR IGNORE INTO alerts (id, transaction_id, risk_level, status, assigned_to, created_at, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(`ALT-${record.id}`, record.id, riskLevel(risk), status, null, now, null));
      }
    }
    if (statements.length) await env.DB.batch(statements);
    await addAuditEvent(actor.userId, 'import', `${importableRecords.length} procurement records imported from ${file.name}; ${duplicateCount} duplicates skipped.`);
    return Response.json({ imported: importableRecords.length, duplicates: duplicateCount, rejected: 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to import CSV.' }, { status: 400 });
  }
}
