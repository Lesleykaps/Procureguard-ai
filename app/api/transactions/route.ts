import { addAuditEvent, getAuthenticatedActor, hasPermission, listTransactions, seedDemoData } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:read')) return Response.json({ error: 'Your role cannot view transactions.' }, { status: 403 });
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM procurement_transactions`).first<{ total: number }>();
    if (!count?.total) await seedDemoData(actor.userId);
    return Response.json({ transactions: await listTransactions() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Database unavailable.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:review')) return Response.json({ error: 'Your role cannot review transactions.' }, { status: 403 });
    const { id, status } = await request.json() as { id?: string; status?: string };
    if (!id || !['Open', 'Reviewed', 'Cleared'].includes(status ?? '')) return Response.json({ error: 'A valid transaction id and status are required.' }, { status: 400 });
    const reviewedAt = status === 'Open' ? null : new Date().toISOString();
    const result = await env.DB.prepare(`UPDATE procurement_transactions SET status = ? WHERE id = ?`).bind(status, id).run();
    await env.DB.prepare(`UPDATE alerts SET status = ?, reviewed_at = ? WHERE transaction_id = ?`).bind(status, reviewedAt, id).run();
    await addAuditEvent(actor.userId, 'status_change', `Transaction ${id} marked as ${status}.`, id);
    return Response.json({ updated: result.meta.changes > 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update transaction.' }, { status: 500 });
  }
}
