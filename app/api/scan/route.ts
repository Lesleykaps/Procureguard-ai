import { addAuditEvent, getAuthenticatedActor, hasPermission, riskLevel, scoreTransaction } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'scan:run')) return Response.json({ error: 'Your role cannot run procurement scans.' }, { status: 403 });
    const result = await env.DB.prepare(`SELECT id, supplier, amount, pattern, model_features_json FROM procurement_transactions`).all<{ id: string; supplier: string; amount: number; pattern: string; model_features_json: string | null }>();
    const records = result.results ?? [];
    const statements = [];
    let flagged = 0;
    let highRiskCount = 0;
    let mediumRiskCount = 0;
    let lowRiskCount = 0;
    let missingFeatureCount = 0;
    let riskTotal = 0;
    let maxRisk = 0;
    const startedAt = Date.now();
    for (const record of records) {
      const storedFeatures = record.model_features_json ? JSON.parse(record.model_features_json) as number[] : undefined;
      const risk = await scoreTransaction(record.pattern, record.amount, storedFeatures);
      if (risk >= 55) flagged += 1;
      if (risk >= 80) highRiskCount += 1;
      else if (risk >= 55) mediumRiskCount += 1;
      else lowRiskCount += 1;
      if (!record.model_features_json) missingFeatureCount += 1;
      riskTotal += risk;
      maxRisk = Math.max(maxRisk, risk);
      statements.push(env.DB.prepare(`UPDATE procurement_transactions SET risk_score = ? WHERE id = ?`).bind(risk, record.id));
      if (risk >= 55) statements.push(env.DB.prepare(`UPDATE alerts SET risk_level = ? WHERE transaction_id = ?`).bind(riskLevel(risk), record.id));
    }
    if (statements.length) await env.DB.batch(statements);
    const durationMs = Date.now() - startedAt;
    await env.DB.prepare(`INSERT INTO scan_runs (id, actor_id, records_scanned, flagged_count, high_risk_count, medium_risk_count, low_risk_count, missing_feature_count, mean_risk, max_risk, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      `SCAN-${crypto.randomUUID()}`,
      actor.userId,
      records.length,
      flagged,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      missingFeatureCount,
      Math.round((riskTotal / Math.max(records.length, 1)) * 10) / 10,
      maxRisk,
      durationMs,
      new Date().toISOString(),
    ).run();
    await addAuditEvent(actor.userId, 'scan', `Scan completed for ${records.length} procurement records; ${flagged} require attention.`);
    return Response.json({ scanned: records.length, flagged, durationMs, meanRisk: Math.round((riskTotal / Math.max(records.length, 1)) * 10) / 10, maxRisk, highRiskCount, mediumRiskCount, lowRiskCount, missingFeatureCount });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to run scan.' }, { status: 503 });
  }
}
