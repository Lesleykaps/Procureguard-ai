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
    for (const record of records) {
      const storedFeatures = record.model_features_json ? JSON.parse(record.model_features_json) as number[] : undefined;
      const risk = scoreTransaction(record.pattern, record.amount, storedFeatures);
      if (risk >= 55) flagged += 1;
      statements.push(env.DB.prepare(`UPDATE procurement_transactions SET risk_score = ? WHERE id = ?`).bind(risk, record.id));
      if (risk >= 55) statements.push(env.DB.prepare(`UPDATE alerts SET risk_level = ? WHERE transaction_id = ?`).bind(riskLevel(risk), record.id));
    }
    if (statements.length) await env.DB.batch(statements);
    await addAuditEvent(actor.userId, 'scan', `Scan completed for ${records.length} procurement records; ${flagged} require attention.`);
    return Response.json({ scanned: records.length, flagged });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to run scan.' }, { status: 503 });
  }
}
