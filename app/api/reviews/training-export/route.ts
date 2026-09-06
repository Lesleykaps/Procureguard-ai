import { getAuthenticatedActor, hasPermission } from '../../../../lib/procurement-db';
import { env } from 'cloudflare:workers';
import { addAuditEvent } from '../../../../lib/procurement-db';

export const dynamic = 'force-dynamic';

function csvCell(value: unknown) {
  let text = '';
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') text = value.toString();
  else if (value !== null && value !== undefined) text = JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'models:read')) return Response.json({ error: 'Your role cannot export training labels.' }, { status: 403 });
    const [transactionsResult, reviewsResult] = await Promise.all([
      env.DB.prepare(`SELECT id, supplier, amount, pattern, risk_score, model_features_json, created_at FROM procurement_transactions`).all<{ id: string; supplier: string; amount: number; pattern: string; risk_score: number; model_features_json: string | null; created_at: string }>(),
      env.DB.prepare(`SELECT transaction_id, decision, note, created_at FROM review_decisions ORDER BY created_at DESC`).all<{ transaction_id: string; decision: string; note: string | null; created_at: string }>(),
    ]);
    const transactionsById = new Map((transactionsResult.results ?? []).map((row) => [row.id, row]));
    const latestReviewByTransaction = new Map<string, { decision: string; note: string | null; created_at: string }>();
    for (const review of reviewsResult.results ?? []) {
      if (!latestReviewByTransaction.has(review.transaction_id)) latestReviewByTransaction.set(review.transaction_id, review);
    }
    const rows: (string | number)[][] = [['transaction_id', 'supplier', 'amount', 'pattern', 'risk_score', 'label_fraud', 'label_source', 'review_note', 'model_features_json', 'transaction_created_at', 'reviewed_at']];
    for (const [transactionId, review] of latestReviewByTransaction.entries()) {
      const transaction = transactionsById.get(transactionId);
      if (!transaction || (review.decision !== 'confirmed_fraud' && review.decision !== 'false_positive')) continue;
      rows.push([transaction.id, transaction.supplier, transaction.amount, transaction.pattern, transaction.risk_score, review.decision === 'confirmed_fraud' ? 1 : 0, 'human_review', review.note ?? '', transaction.model_features_json ?? '', transaction.created_at, review.created_at]);
    }
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
    await addAuditEvent(actor.userId, 'training_export', `Training label dataset exported with ${rows.length - 1} adjudicated cases.`);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="procureguard-reviewed-labels-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Training label export unavailable.' }, { status: 503 });
  }
}
