import { getAuthenticatedActor, hasPermission } from '../../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type TransactionRecord = { id: string; supplier: string; amount: number; pattern: string; risk_score: number; status: string; reason: string; created_at: string };
type ReviewRecord = { transaction_id: string; decision: string; created_at: string };

function percentage(value: number, total: number) {
  return total ? Number(((value / total) * 100).toFixed(1)) : 0;
}

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:read')) return Response.json({ error: 'Your role cannot view the review queue.' }, { status: 403 });
    const [transactionsResult, reviewsResult] = await Promise.all([
      env.DB.prepare(`SELECT id, supplier, amount, pattern, risk_score, status, reason, created_at FROM procurement_transactions`).all<TransactionRecord>(),
      env.DB.prepare(`SELECT transaction_id, decision, created_at FROM review_decisions ORDER BY created_at DESC`).all<ReviewRecord>(),
    ]);
    const transactions = transactionsResult.results ?? [];
    const latestReviewByTransaction = new Map<string, ReviewRecord>();
    for (const review of reviewsResult.results ?? []) {
      if (!latestReviewByTransaction.has(review.transaction_id)) latestReviewByTransaction.set(review.transaction_id, review);
    }
    const labelled = transactions.filter((transaction) => {
      const decision = latestReviewByTransaction.get(transaction.id)?.decision;
      return decision === 'confirmed_fraud' || decision === 'false_positive';
    });
    const confirmedFraud = labelled.filter((transaction) => latestReviewByTransaction.get(transaction.id)?.decision === 'confirmed_fraud').length;
    const falsePositive = labelled.length - confirmedFraud;
    const needsEvidence = transactions.filter((transaction) => latestReviewByTransaction.get(transaction.id)?.decision === 'needs_evidence').length;
    const queue = transactions
      .filter((transaction) => {
        const decision = latestReviewByTransaction.get(transaction.id)?.decision;
        return decision !== 'confirmed_fraud' && decision !== 'false_positive';
      })
      .sort((left, right) => {
        const leftDecision = latestReviewByTransaction.get(left.id)?.decision;
        const rightDecision = latestReviewByTransaction.get(right.id)?.decision;
        const leftPriority = leftDecision === 'needs_evidence' ? 1 : 0;
        const rightPriority = rightDecision === 'needs_evidence' ? 1 : 0;
        return leftPriority - rightPriority || right.risk_score - left.risk_score || left.created_at.localeCompare(right.created_at);
      })
      .slice(0, 12)
      .map((transaction) => {
        const review = latestReviewByTransaction.get(transaction.id);
        return {
          id: transaction.id,
          supplier: transaction.supplier,
          amount: transaction.amount,
          pattern: transaction.pattern,
          risk: transaction.risk_score,
          status: transaction.status,
          reason: transaction.reason,
          createdAt: transaction.created_at,
          reviewState: review?.decision === 'needs_evidence' ? 'needs_evidence' : 'unreviewed',
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
        unreviewed: Math.max(0, unreviewed),
        highRiskUnreviewed,
        percentage: percentage(labelled.length, total),
        targetCases: 30,
        remainingToTarget: Math.max(0, 30 - labelled.length),
        readyForTraining: labelled.length >= 30 && confirmedFraud > 0 && falsePositive > 0,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Review queue unavailable.' }, { status: 503 });
  }
}
