import { getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type LabelledCase = { risk: number; actualFraud: boolean };

function metrics(cases: LabelledCase[], threshold: number) {
  let truePositive = 0;
  let falseNegative = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  for (const item of cases) {
    const predictedFraud = item.risk >= threshold;
    if (item.actualFraud && predictedFraud) truePositive += 1;
    else if (item.actualFraud) falseNegative += 1;
    else if (predictedFraud) falsePositive += 1;
    else trueNegative += 1;
  }
  const total = cases.length;
  const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0;
  const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0;
  const falsePositiveRate = falsePositive + trueNegative ? falsePositive / (falsePositive + trueNegative) : 0;
  const f2 = precision + recall ? (5 * precision * recall) / (4 * precision + recall) : 0;
  return {
    threshold,
    accuracy: Number((((truePositive + trueNegative) / Math.max(total, 1)) * 100).toFixed(1)),
    precision: Number((precision * 100).toFixed(1)),
    recall: Number((recall * 100).toFixed(1)),
    falsePositiveRate: Number((falsePositiveRate * 100).toFixed(1)),
    f2: Number((f2 * 100).toFixed(1)),
    confusionMatrix: { truePositive, falseNegative, falsePositive, trueNegative },
  };
}

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'models:read')) return Response.json({ error: 'Your role cannot view calibration proposals.' }, { status: 403 });
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
    const labelledCases: LabelledCase[] = [...latestReviewByTransaction.entries()].flatMap(([id, decision]) => {
      const risk = riskByTransaction.get(id);
      return risk !== undefined && (decision === 'confirmed_fraud' || decision === 'false_positive') ? [{ risk, actualFraud: decision === 'confirmed_fraud' }] : [];
    });
    const currentThreshold = 55;
    const currentMetrics = metrics(labelledCases, currentThreshold);
    const candidates = Array.from({ length: 91 }, (_, index) => metrics(labelledCases, index + 5));
    const conservativeCandidates = candidates.filter((candidate) => candidate.falsePositiveRate <= 8);
    const ranked = (conservativeCandidates.length ? conservativeCandidates : candidates).sort((left, right) => right.f2 - left.f2 || right.recall - left.recall || Math.abs(left.threshold - currentThreshold) - Math.abs(right.threshold - currentThreshold));
    const proposed = labelledCases.length ? ranked[0] : null;
    return Response.json({ calibration: {
      sampleCount: labelledCases.length,
      currentThreshold,
      proposedThreshold: proposed?.threshold ?? null,
      readyForCalibration: labelledCases.length >= 30,
      currentMetrics,
      proposedMetrics: proposed,
      note: 'This is a reviewer-grounded proposal. It does not change the active model; approve and retrain only after sufficient real labels and governance review.',
    } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Calibration proposal unavailable.' }, { status: 503 });
  }
}
