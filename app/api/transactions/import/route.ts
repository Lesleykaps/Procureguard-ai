import { addAuditEvent, getAuthenticatedActor, hasPermission, parseCsv, riskLevel, scoreTransaction } from '../../../../lib/procurement-db';
import { assertSupabase, getSupabaseServer } from '../../../../lib/supabase-server';

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
    const supabase = getSupabaseServer();
    const existingIds = new Set<string>();
    for (let start = 0; start < uniqueRecords.length; start += 500) {
      const chunk = uniqueRecords.slice(start, start + 500);
      const existing = await supabase.from('procurement_transactions').select('id').in('id', chunk.map((record) => record.id));
      assertSupabase(existing);
      for (const row of existing.data ?? []) existingIds.add(row.id);
    }
    const importableRecords = uniqueRecords.filter((record) => !existingIds.has(record.id));
    const duplicateCount = records.length - importableRecords.length;
    const now = new Date().toISOString();
    const transactions = [];
    const alerts = [];
    for (const record of importableRecords) {
      const risk = await scoreTransaction(record.pattern, record.amount, record.modelFeatures);
      const status = 'Open';
      const reason = `Scored from ${record.pattern.toLowerCase()} signal and a $${record.amount.toLocaleString()} procurement value.`;
      transactions.push({ id: record.id, supplier: record.supplier, amount: record.amount, pattern: record.pattern, risk_score: risk, status, reason, source_file: file.name, model_features_json: record.modelFeatures, created_at: now });
      if (risk >= 55) {
        alerts.push({ id: `ALT-${record.id}`, transaction_id: record.id, risk_level: riskLevel(risk), status, assigned_to: null, created_at: now, reviewed_at: null });
      }
    }
    if (transactions.length) { const saved = await supabase.from('procurement_transactions').insert(transactions); assertSupabase(saved); }
    if (alerts.length) { const savedAlerts = await supabase.from('alerts').insert(alerts); assertSupabase(savedAlerts); }
    await addAuditEvent(actor.userId, 'import', `${importableRecords.length} procurement records imported from ${file.name}; ${duplicateCount} duplicates skipped.`);
    return Response.json({ imported: importableRecords.length, duplicates: duplicateCount, rejected: 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to import CSV.' }, { status: 400 });
  }
}
