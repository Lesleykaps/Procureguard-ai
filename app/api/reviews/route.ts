import { addAuditEvent, getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

const decisions = ['confirmed_fraud', 'false_positive', 'needs_evidence'] as const;
type ReviewDecision = typeof decisions[number];

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:read')) return Response.json({ error: 'Your role cannot view review decisions.' }, { status: 403 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'A transaction id is required.' }, { status: 400 });
    const result = await env.DB.prepare(`SELECT id, transaction_id, actor_id, decision, note, created_at FROM review_decisions WHERE transaction_id = ? ORDER BY created_at DESC LIMIT 20`).bind(id).all();
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
    const { transactionId, decision, note } = await request.json() as { transactionId?: string; decision?: string; note?: string };
    if (!transactionId || !decisions.includes(decision as ReviewDecision)) return Response.json({ error: 'A valid transaction id and review decision are required.' }, { status: 400 });
    if (note && note.length > 1000) return Response.json({ error: 'Review notes must be 1,000 characters or fewer.' }, { status: 400 });
    const transaction = await env.DB.prepare(`SELECT id FROM procurement_transactions WHERE id = ?`).bind(transactionId).first<{ id: string }>();
    if (!transaction) return Response.json({ error: 'Transaction not found.' }, { status: 404 });
    const createdAt = new Date().toISOString();
    const review = { id: `REV-${crypto.randomUUID()}`, transaction_id: transactionId, actor_id: actor.userId, decision, note: note?.trim() || null, created_at: createdAt };
    await env.DB.prepare(`INSERT INTO review_decisions (id, transaction_id, actor_id, decision, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`).bind(review.id, review.transaction_id, review.actor_id, review.decision, review.note, review.created_at).run();
    await addAuditEvent(actor.userId, 'review_decision', `Review decision ${decision} recorded for ${transactionId}.`, transactionId);
    return Response.json({ review }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to record review decision.' }, { status: 500 });
  }
}
