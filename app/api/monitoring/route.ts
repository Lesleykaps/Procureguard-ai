import { getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:read')) return Response.json({ error: 'Your role cannot view operational monitoring.' }, { status: 403 });

    const [scanResult, totals] = await Promise.all([
      env.DB.prepare(`SELECT id, actor_id, records_scanned, flagged_count, mean_risk, max_risk, duration_ms, created_at FROM scan_runs ORDER BY created_at DESC LIMIT 10`).all(),
      env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN risk_score >= 55 THEN 1 ELSE 0 END), 0) AS flagged, COALESCE(SUM(CASE WHEN status = 'Open' AND risk_score >= 55 THEN 1 ELSE 0 END), 0) AS open_flagged FROM procurement_transactions`).first<{ total: number; flagged: number; open_flagged: number }>(),
    ]);
    const recentScans = scanResult.results ?? [];
    return Response.json({
      monitoring: {
        latestScan: recentScans[0] ?? null,
        recentScans,
        transactionTotals: {
          total: Number(totals?.total ?? 0),
          flagged: Number(totals?.flagged ?? 0),
          openFlagged: Number(totals?.open_flagged ?? 0),
        },
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Operational monitoring unavailable.' }, { status: 503 });
  }
}
