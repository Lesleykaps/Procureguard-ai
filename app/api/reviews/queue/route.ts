import { getAuthenticatedActor, hasPermission } from '../../../../lib/procurement-db';
import { assertSupabase, getSupabaseServer } from '../../../../lib/supabase-server';

export const dynamic = 'force-dynamic';

type TransactionRecord = { id: string; supplier: string; amount: number; pattern: string; risk_score: number; status: string; reason: string; created_at: string };
type ReviewRecord = { transaction_id: string; decision: string; review_type: string; actor_id: string; created_at: string };

function percentage(value: number, total: number) {
  return total ? Number(((value / total) * 100).toFixed(1)) : 0;
}

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:read')) return Response.json({ error: 'Your role cannot view the review queue.' }, { status: 403 });
    const supabase = getSupabaseServer();
    const [transactionsResult, reviewsResult] = await Promise.all([
      supabase.from('procurement_transactions').select('id, supplier, amount, pattern, risk_score, status, reason, created_at'),
      supabase.from('review_decisions').select('transaction_id, decision, review_type, actor_id, created_at').order('created_at', { ascending: false }),
    ]);
    assertSupabase(transactionsResult); assertSupabase(reviewsResult);
    const transactions = (transactionsResult.data ?? []) as TransactionRecord[];
    const latestInitialByTransaction = new Map<string, ReviewRecord>();
    const latestResolutionByTransaction = new Map<string, ReviewRecord>();
    const initialDecisionsByTransaction = new Map<string, Set<string>>();
    const reviewCounts = new Map<string, number>();
    const reviewers = new Set<string>();
    for (const review of (reviewsResult.data ?? []) as ReviewRecord[]) {
      reviewers.add(review.actor_id);
      reviewCounts.set(review.transaction_id, (reviewCounts.get(review.transaction_id) ?? 0) + 1);
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
    const effectiveReviewByTransaction = new Map<string, ReviewRecord>();
    for (const transaction of transactions) {
      const effective = latestResolutionByTransaction.get(transaction.id) ?? latestInitialByTransaction.get(transaction.id);
      if (effective) effectiveReviewByTransaction.set(transaction.id, effective);
    }
    const labelled = transactions.filter((transaction) => {
      const decision = effectiveReviewByTransaction.get(transaction.id)?.decision;
      return decision === 'confirmed_fraud' || decision === 'false_positive';
    });
    const confirmedFraud = labelled.filter((transaction) => effectiveReviewByTransaction.get(transaction.id)?.decision === 'confirmed_fraud').length;
    const falsePositive = labelled.length - confirmedFraud;
    const needsEvidence = transactions.filter((transaction) => effectiveReviewByTransaction.get(transaction.id)?.decision === 'needs_evidence').length;
    const conflictingCases = transactions.filter((transaction) => (initialDecisionsByTransaction.get(transaction.id)?.size ?? 0) > 1 && !latestResolutionByTransaction.has(transaction.id)).length;
    const eligibleForTraining = Math.max(0, labelled.length - conflictingCases);
    const queue = transactions
      .filter((transaction) => {
        const decision = effectiveReviewByTransaction.get(transaction.id)?.decision;
        const conflicting = (initialDecisionsByTransaction.get(transaction.id)?.size ?? 0) > 1 && !latestResolutionByTransaction.has(transaction.id);
        return conflicting || (decision !== 'confirmed_fraud' && decision !== 'false_positive');
      })
      .sort((left, right) => {
        const leftDecision = effectiveReviewByTransaction.get(left.id)?.decision;
        const rightDecision = effectiveReviewByTransaction.get(right.id)?.decision;
        const leftConflict = (initialDecisionsByTransaction.get(left.id)?.size ?? 0) > 1 && !latestResolutionByTransaction.has(left.id);
        const rightConflict = (initialDecisionsByTransaction.get(right.id)?.size ?? 0) > 1 && !latestResolutionByTransaction.has(right.id);
        const leftPriority = leftConflict ? 2 : leftDecision === 'needs_evidence' ? 1 : 0;
        const rightPriority = rightConflict ? 2 : rightDecision === 'needs_evidence' ? 1 : 0;
        return rightPriority - leftPriority || right.risk_score - left.risk_score || left.created_at.localeCompare(right.created_at);
      })
      .slice(0, 12)
      .map((transaction) => {
        const review = effectiveReviewByTransaction.get(transaction.id);
        const conflicting = (initialDecisionsByTransaction.get(transaction.id)?.size ?? 0) > 1 && !latestResolutionByTransaction.has(transaction.id);
        return {
          id: transaction.id,
          supplier: transaction.supplier,
          amount: transaction.amount,
          pattern: transaction.pattern,
          risk: transaction.risk_score,
          status: transaction.status,
          reason: transaction.reason,
          createdAt: transaction.created_at,
          reviewState: conflicting ? 'conflict' : review?.decision === 'needs_evidence' ? 'needs_evidence' : 'unreviewed',
          reviewCount: reviewCounts.get(transaction.id) ?? 0,
          priority: transaction.risk_score >= 80 ? 'high' : transaction.risk_score >= 55 ? 'medium' : 'low',
        };
      });
    const total = transactions.length;
    const unreviewed = total - labelled.length - needsEvidence;
    const highRiskUnreviewed = queue.filter((item) => item.reviewState === 'unreviewed' && item.risk >= 55).length;
    return Response.json({
      queue,
      coverage: {
        total,
        labelled: labelled.length,
        confirmedFraud,
        falsePositive,
        needsEvidence,
        conflictingCases,
        eligibleForTraining,
        needsSecondReview: conflictingCases,
        reviewerCount: reviewers.size,
        unreviewed: Math.max(0, unreviewed),
        highRiskUnreviewed,
        percentage: percentage(labelled.length, total),
        targetCases: 30,
        remainingToTarget: Math.max(0, 30 - eligibleForTraining),
        readyForTraining: eligibleForTraining >= 30 && confirmedFraud > 0 && falsePositive > 0 && conflictingCases === 0,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Review queue unavailable.' }, { status: 503 });
  }
}
