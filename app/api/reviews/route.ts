import { addAuditEvent, getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { assertSupabase, getSupabaseServer } from '../../../lib/supabase-server';

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
    const result = await getSupabaseServer().from('review_decisions').select('id, transaction_id, actor_id, decision, review_type, note, created_at').eq('transaction_id', id).order('created_at', { ascending: false }).limit(20);
    assertSupabase(result);
    return Response.json({ reviews: result.data ?? [] });
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
    const supabase = getSupabaseServer();
    const transactionResult = await supabase.from('procurement_transactions').select('id').eq('id', transactionId).maybeSingle();
    assertSupabase(transactionResult);
    const transaction = transactionResult.data;
    if (!transaction) return Response.json({ error: 'Transaction not found.' }, { status: 404 });
    if (reviewType === 'resolution' && !note?.trim()) return Response.json({ error: 'A resolution note is required for the audit trail.' }, { status: 400 });
    if (reviewType === 'resolution') {
      const prior = await supabase.from('review_decisions').select('decision, review_type').eq('transaction_id', transactionId);
      assertSupabase(prior);
      const hasResolution = (prior.data ?? []).some((review) => review.review_type === 'resolution');
      const initialDecisions = new Set((prior.data ?? []).filter((review) => review.review_type !== 'resolution' && (review.decision === 'confirmed_fraud' || review.decision === 'false_positive')).map((review) => review.decision));
      if (!hasResolution && initialDecisions.size < 2) return Response.json({ error: 'A resolution is only available after conflicting definitive labels exist.' }, { status: 409 });
    }
    const createdAt = new Date().toISOString();
    const review = { id: `REV-${crypto.randomUUID()}`, transaction_id: transactionId, actor_id: actor.userId, decision, review_type: reviewType, note: note?.trim() || null, created_at: createdAt };
    const savedReview = await supabase.from('review_decisions').insert(review);
    assertSupabase(savedReview);
    await addAuditEvent(actor.userId, 'review_decision', `${reviewType === 'resolution' ? 'Resolution' : 'Review'} decision ${decision} recorded for ${transactionId}.`, transactionId);
    return Response.json({ review }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to record review decision.' }, { status: 500 });
  }
}
