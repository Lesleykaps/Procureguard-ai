import { addAuditEvent, getAuthenticatedActor, hasPermission, riskLevel, scoreTransactionBatch } from '../../../lib/procurement-db';
import { assertSupabase, getSupabaseServer } from '../../../lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'scan:run')) return Response.json({ error: 'Your role cannot run procurement scans.' }, { status: 403 });
    const supabase = getSupabaseServer();
    let flagged = 0;
    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let lowRiskCount = 0;
    let missingFeatureCount = 0;
    let riskTotal = 0;
    let maxRisk = 0;
    const startedAt = Date.now();
    let scanned = 0;
    const idsByRisk = new Map<number, string[]>();
    const alertIds = new Map<string, string[]>();
    for (let from = 0; ; from += 500) {
      const result = await supabase.from('procurement_transactions').select('id, supplier, amount, pattern, model_features_json').order('id').range(from, from + 499);
      assertSupabase(result);
      const records = result.data ?? [];
      const risks = await scoreTransactionBatch(records);
      for (const [recordIndex, record] of records.entries()) {
        const risk = risks[recordIndex];
        scanned += 1;
        if (risk >= 55) flagged += 1;
        if (risk >= 80) highRiskCount += 1; else if (risk >= 55) mediumRiskCount += 1; else lowRiskCount += 1;
        if (!record.model_features_json) missingFeatureCount += 1;
        riskTotal += risk; maxRisk = Math.max(maxRisk, risk);
        idsByRisk.set(risk, [...(idsByRisk.get(risk) ?? []), record.id]);
        if (risk >= 55) { const level = riskLevel(risk); alertIds.set(level, [...(alertIds.get(level) ?? []), record.id]); }
      }
      if (records.length < 500) break;
    }
    for (const [risk, ids] of idsByRisk) for (let index = 0; index < ids.length; index += 500) assertSupabase(await supabase.from('procurement_transactions').update({ risk_score: risk }).in('id', ids.slice(index, index + 500)));
    for (const [level, ids] of alertIds) for (let index = 0; index < ids.length; index += 500) assertSupabase(await supabase.from('alerts').update({ risk_level: level }).in('transaction_id', ids.slice(index, index + 500)));
    const durationMs = Date.now() - startedAt;
    const scan = await supabase.from('scan_runs').insert({ id: `SCAN-${crypto.randomUUID()}`, actor_id: actor.userId, records_scanned: scanned, flagged_count: flagged, high_risk_count: highRiskCount, medium_risk_count: mediumRiskCount, low_risk_count: lowRiskCount, missing_feature_count: missingFeatureCount, mean_risk: Math.round((riskTotal / Math.max(scanned, 1)) * 10) / 10, max_risk: maxRisk, duration_ms: durationMs, created_at: new Date().toISOString() });
    assertSupabase(scan);
    await addAuditEvent(actor.userId, 'scan', `Scan completed for ${scanned} procurement records; ${flagged} require attention.`);
    return Response.json({ scanned, flagged, durationMs, meanRisk: Math.round((riskTotal / Math.max(scanned, 1)) * 10) / 10, maxRisk, highRiskCount, mediumRiskCount, lowRiskCount, missingFeatureCount });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to run scan.' }, { status: 503 });
  }
}
