import { getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';
import trainedArtifact from '../../../ml/model-artifacts.json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:read')) return Response.json({ error: 'Your role cannot view operational monitoring.' }, { status: 403 });

    const [scanResult, totals] = await Promise.all([
      env.DB.prepare(`SELECT id, actor_id, records_scanned, flagged_count, high_risk_count, medium_risk_count, low_risk_count, missing_feature_count, mean_risk, max_risk, duration_ms, created_at FROM scan_runs ORDER BY created_at DESC LIMIT 10`).all(),
      env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN risk_score >= 55 THEN 1 ELSE 0 END), 0) AS flagged, COALESCE(SUM(CASE WHEN status = 'Open' AND risk_score >= 55 THEN 1 ELSE 0 END), 0) AS open_flagged FROM procurement_transactions`).first<{ total: number; flagged: number; open_flagged: number }>(),
    ]);
    const recentScans = scanResult.results ?? [];
    const latestScan = recentScans[0] as { records_scanned?: number; flagged_count?: number; missing_feature_count?: number } | undefined;
    const recordsScanned = Number(latestScan?.records_scanned ?? 0);
    const flaggedCount = Number(latestScan?.flagged_count ?? 0);
    const referenceFraudRate = Number(trainedArtifact.dataset.fraudRate);
    const flaggedRate = recordsScanned ? Number(((flaggedCount / recordsScanned) * 100).toFixed(1)) : null;
    const rateDelta = flaggedRate === null ? null : Number((flaggedRate - referenceFraudRate).toFixed(1));
    return Response.json({
      monitoring: {
        latestScan: recentScans[0] ?? null,
        recentScans,
        scoreDistribution: {
          flaggedRate,
          referenceFraudRate,
          rateDelta,
          status: flaggedRate === null ? 'no_scan' : Math.abs(rateDelta ?? 0) <= 10 ? 'within_reference' : 'review_required',
          note: 'Reference rate comes from the synthetic development dataset and is a drift signal, not production ground truth.',
        },
        dataQuality: {
          missingFeatureCount: Number(latestScan?.missing_feature_count ?? 0),
          featureCompleteness: recordsScanned ? Number((((recordsScanned - Number(latestScan?.missing_feature_count ?? 0)) / recordsScanned) * 100).toFixed(1)) : null,
        },
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
