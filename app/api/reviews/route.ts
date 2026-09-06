import { addAuditEvent, getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

const decisions = ['confirmed_fraud', 'false_positive', 'needs_evidence'] as const;
const reviewTypes = ['initial', 'resolution'] as const;
type ReviewDecision = typeof decisions[number];
type ReviewType = typeof reviewTypes[number];

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:read')) return Response.json({ error: 'Your role cannot view review decisions.' }, { status: 403 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'A transaction id is required.' }, { status: 400 });
    const result = await env.DB.prepare(`SELECT id, transaction_id, actor_id, decision, review_type, note, created_at FROM review_decisions WHERE transaction_id = ? ORDER BY created_at DESC LIMIT 20`).bind(id).all();
    return Response.json({ reviews: result.results ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Review history unavailable.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:review')) return Response.json({ error: 'Your role cannot record review decisions.' }, { status: 403 });
    const { transactionId, decision, note, reviewType = 'initial' } = await request.json() as { transactionId?: string; decision?: string; note?: string; reviewType?: string };
    if (!transactionId || !decisions.includes(decision as ReviewDecision)) return Response.json({ error: 'A valid transaction id and review decision are required.' }, { status: 400 });
    if (!reviewTypes.includes(reviewType as ReviewType)) return Response.json({ error: 'A valid review type is required.' }, { status: 400 });
    if (note && note.length > 1000) return Response.json({ error: 'Review notes must be 1,000 characters or fewer.' }, { status: 400 });
    if (reviewType === 'resolution' && !hasPermission(actor.role, 'models:read')) return Response.json({ error: 'Only Managers and Admins can resolve disputed labels.' }, { status: 403 });
    const transaction = await env.DB.prepare(`SELECT id FROM procurement_transactions WHERE id = ?`).bind(transactionId).first<{ id: string }>();
    if (!transaction) return Response.json({ error: 'Transaction not found.' }, { status: 404 });
    if (reviewType === 'resolution' && !note?.trim()) return Response.json({ error: 'A resolution note is required for the audit trail.' }, { status: 400 });
    if (reviewType === 'resolution') {
      const prior = await env.DB.prepare(`SELECT decision, review_type FROM review_decisions WHERE transaction_id = ?`).bind(transactionId).all<{ decision: string; review_type: string }>();
      const hasResolution = (prior.results ?? []).some((review) => review.review_type === 'resolution');
      const initialDecisions = new Set((prior.results ?? []).filter((review) => review.review_type !== 'resolution' && (review.decision === 'confirmed_fraud' || review.decision === 'false_positive')).map((review) => review.decision));
      if (!hasResolution && initialDecisions.size < 2) return Response.json({ error: 'A resolution is only available after conflicting definitive labels exist.' }, { status: 409 });
    }
    const createdAt = new Date().toISOString();
    const review = { id: `REV-${crypto.randomUUID()}`, transaction_id: transactionId, actor_id: actor.userId, decision, review_type: reviewType, note: note?.trim() || null, created_at: createdAt };
    await env.DB.prepare(`INSERT INTO review_decisions (id, transaction_id, actor_id, decision, review_type, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(review.id, review.transaction_id, review.actor_id, review.decision, review.review_type, review.note, review.created_at).run();
    await addAuditEvent(actor.userId, 'review_decision', `${reviewType === 'resolution' ? 'Resolution' : 'Review'} decision ${decision} recorded for ${transactionId}.`, transactionId);
    return Response.json({ review }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to record review decision.' }, { status: 500 });
  }
}
