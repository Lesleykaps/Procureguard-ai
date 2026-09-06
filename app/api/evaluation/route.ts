import { getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

function percentage(value: number, total: number) {
  return total ? Number(((value / total) * 100).toFixed(1)) : null;
}

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'models:read')) return Response.json({ error: 'Your role cannot view model evaluation.' }, { status: 403 });
    const [transactionsResult, reviewsResult] = await Promise.all([
      env.DB.prepare(`SELECT id, risk_score FROM procurement_transactions`).all<{ id: string; risk_score: number }>(),
      env.DB.prepare(`SELECT transaction_id, decision, review_type, created_at FROM review_decisions ORDER BY created_at DESC`).all<{ transaction_id: string; decision: string; review_type: string; created_at: string }>(),
    ]);
    const riskByTransaction = new Map((transactionsResult.results ?? []).map((row) => [row.id, row.risk_score]));
    const latestReviewByTransaction = new Map<string, string>();
    const latestResolutionByTransaction = new Map<string, string>();
    for (const review of reviewsResult.results ?? []) {
      if (!latestReviewByTransaction.has(review.transaction_id)) latestReviewByTransaction.set(review.transaction_id, review.decision);
      if (review.review_type === 'resolution' && !latestResolutionByTransaction.has(review.transaction_id)) latestResolutionByTransaction.set(review.transaction_id, review.decision);
    }
    for (const [transactionId, decision] of latestResolutionByTransaction.entries()) latestReviewByTransaction.set(transactionId, decision);
    const confirmedFraud = [...latestReviewByTransaction.entries()].filter(([id, decision]) => decision === 'confirmed_fraud' && riskByTransaction.has(id)).length;
    const falsePositive = [...latestReviewByTransaction.entries()].filter(([id, decision]) => decision === 'false_positive' && riskByTransaction.has(id)).length;
    const pendingReviewCount = [...latestReviewByTransaction.values()].filter((decision) => decision === 'needs_evidence').length;
    let truePositive = 0;
    let falseNegative = 0;
    let falsePositiveCount = 0;
    let trueNegative = 0;
    for (const [id, decision] of latestReviewByTransaction.entries()) {
      const risk = riskByTransaction.get(id);
      if (risk === undefined || (decision !== 'confirmed_fraud' && decision !== 'false_positive')) continue;
      const predictedFraud = risk >= 55;
      if (decision === 'confirmed_fraud' && predictedFraud) truePositive += 1;
      else if (decision === 'confirmed_fraud') falseNegative += 1;
      else if (predictedFraud) falsePositiveCount += 1;
      else trueNegative += 1;
    }
    const sampleCount = truePositive + falseNegative + falsePositiveCount + trueNegative;
    return Response.json({ evaluation: {
      sampleCount,
      confirmedFraud,
      falsePositive,
      pendingReviewCount,
      readyForCalibration: sampleCount >= 30,
      confusionMatrix: { truePositive, falseNegative, falsePositive: falsePositiveCount, trueNegative },
      metrics: {
        accuracy: percentage(truePositive + trueNegative, sampleCount),
        precision: percentage(truePositive, truePositive + falsePositiveCount),
        recall: percentage(truePositive, truePositive + falseNegative),
        falsePositiveRate: percentage(falsePositiveCount, falsePositiveCount + trueNegative),
      },
    } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Model evaluation unavailable.' }, { status: 503 });
  }
}
