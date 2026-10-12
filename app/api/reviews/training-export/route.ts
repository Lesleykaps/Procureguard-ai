import { addAuditEvent, getAuthenticatedActor, hasPermission, modelFeatures } from '../../../../lib/procurement-db';
import { getSupabaseServer } from '../../../../lib/supabase-server';
import { fetchAllPages } from '../../../../lib/supabase-pagination';

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
    const supabase = getSupabaseServer();
    const [transactionsResult, reviewsResult] = await Promise.all([
      fetchAllPages((from, to) => supabase.from('procurement_transactions').select('id, supplier, amount, pattern, risk_score, model_features_json, created_at').range(from, to)),
      fetchAllPages((from, to) => supabase.from('review_decisions').select('transaction_id, decision, review_type, note, created_at').order('created_at', { ascending: false }).range(from, to)),
    ]);
    const transactionsById = new Map(transactionsResult.map((row) => [row.id, row]));
    const latestInitialByTransaction = new Map<string, { decision: string; note: string | null; created_at: string }>();
    const latestResolutionByTransaction = new Map<string, { decision: string; note: string | null; created_at: string }>();
    const initialDecisionsByTransaction = new Map<string, Set<string>>();
    for (const review of reviewsResult) {
      if (review.review_type === 'resolution') {
        if (!latestResolutionByTransaction.has(review.transaction_id)) latestResolutionByTransaction.set(review.transaction_id, review);
      } else {
        if (review.decision === 'confirmed_fraud' || review.decision === 'false_positive') {
          const decisions = initialDecisionsByTransaction.get(review.transaction_id) ?? new Set<string>();
          decisions.add(review.decision);
          initialDecisionsByTransaction.set(review.transaction_id, decisions);
        }
        if (!latestInitialByTransaction.has(review.transaction_id)) latestInitialByTransaction.set(review.transaction_id, review);
      }
    }
    const effectiveReviewByTransaction = new Map<string, { decision: string; note: string | null; created_at: string }>();
    for (const [transactionId, review] of latestInitialByTransaction.entries()) effectiveReviewByTransaction.set(transactionId, latestResolutionByTransaction.get(transactionId) ?? review);
    for (const [transactionId, review] of latestResolutionByTransaction.entries()) effectiveReviewByTransaction.set(transactionId, review);
    const rows: (string | number)[][] = [['transaction_id', 'supplier', 'amount', 'pattern', 'risk_score', 'label_fraud', 'label_source', 'review_note', 'model_features_json', 'transaction_created_at', 'reviewed_at']];
    for (const [transactionId, review] of effectiveReviewByTransaction.entries()) {
      const transaction = transactionsById.get(transactionId);
      if (!transaction || (review.decision !== 'confirmed_fraud' && review.decision !== 'false_positive')) continue;
      if ((initialDecisionsByTransaction.get(transactionId)?.size ?? 0) > 1 && !latestResolutionByTransaction.has(transactionId)) continue;
      const featureVector = JSON.stringify(transaction.model_features_json ?? modelFeatures(transaction.pattern, transaction.amount));
      rows.push([transaction.id, transaction.supplier, transaction.amount, transaction.pattern, transaction.risk_score, review.decision === 'confirmed_fraud' ? 1 : 0, 'human_review', review.note ?? '', featureVector, transaction.created_at, review.created_at]);
    }
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
    const omittedConflicts = [...initialDecisionsByTransaction.entries()].filter(([transactionId, decisions]) => decisions.size > 1 && !latestResolutionByTransaction.has(transactionId)).length;
    const resolvedConflicts = [...initialDecisionsByTransaction.entries()].filter(([transactionId, decisions]) => decisions.size > 1 && latestResolutionByTransaction.has(transactionId)).length;
    await addAuditEvent(actor.userId, 'training_export', `Training label dataset exported with ${rows.length - 1} adjudicated cases; ${omittedConflicts} unresolved conflict(s) omitted and ${resolvedConflicts} resolved conflict(s) included.`);
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="procureguard-reviewed-labels-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Training label export unavailable.' }, { status: 503 });
  }
}
