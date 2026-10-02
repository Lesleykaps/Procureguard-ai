import { addAuditEvent, getAuthenticatedActor, hasPermission, riskLevel, scoreTransaction } from '../../../lib/procurement-db';
import { assertSupabase, getSupabaseServer } from '../../../lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'scan:run')) return Response.json({ error: 'Your role cannot run procurement scans.' }, { status: 403 });
    const supabase = getSupabaseServer();
    const result = await supabase.from('procurement_transactions').select('id, supplier, amount, pattern, model_features_json');
    assertSupabase(result);
    const records = result.data ?? [];
    let flagged = 0;
    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let lowRiskCount = 0;
    let missingFeatureCount = 0;
    let riskTotal = 0;
    let maxRisk = 0;
    const startedAt = Date.now();
    for (const record of records) {
      const storedFeatures = Array.isArray(record.model_features_json) ? record.model_features_json as number[] : undefined;
      const risk = await scoreTransaction(record.pattern, record.amount, storedFeatures);
      if (risk >= 55) flagged += 1;
      if (risk >= 80) highRiskCount += 1;
      else if (risk >= 55) mediumRiskCount += 1;
      else lowRiskCount += 1;
      if (!record.model_features_json) missingFeatureCount += 1;
      riskTotal += risk;
      maxRisk = Math.max(maxRisk, risk);
      const saved = await supabase.from('procurement_transactions').update({ risk_score: risk }).eq('id', record.id);
      assertSupabase(saved);
      if (risk >= 55) { const updatedAlert = await supabase.from('alerts').update({ risk_level: riskLevel(risk) }).eq('transaction_id', record.id); assertSupabase(updatedAlert); }
    }
    const durationMs = Date.now() - startedAt;
    const scan = await supabase.from('scan_runs').insert({ id: `SCAN-${crypto.randomUUID()}`, actor_id: actor.userId, records_scanned: records.length, flagged_count: flagged, high_risk_count: highRiskCount, medium_risk_count: mediumRiskCount, low_risk_count: lowRiskCount, missing_feature_count: missingFeatureCount, mean_risk: Math.round((riskTotal / Math.max(records.length, 1)) * 10) / 10, max_risk: maxRisk, duration_ms: durationMs, created_at: new Date().toISOString() });
    assertSupabase(scan);
    await addAuditEvent(actor.userId, 'scan', `Scan completed for ${records.length} procurement records; ${flagged} require attention.`);
    return Response.json({ scanned: records.length, flagged, durationMs, meanRisk: Math.round((riskTotal / Math.max(records.length, 1)) * 10) / 10, maxRisk, highRiskCount, mediumRiskCount, lowRiskCount, missingFeatureCount });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to run scan.' }, { status: 503 });
  }
}
