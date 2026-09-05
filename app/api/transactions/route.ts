import { actorFromRequest, addAuditEvent, listTransactions, seedDemoData } from '../../../lib/procurement-db';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM procurement_transactions`).first<{ total: number }>();
    if (!count?.total) await seedDemoData(actorFromRequest(request));
    return Response.json({ transactions: await listTransactions() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Database unavailable.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, status } = await request.json() as { id?: string; status?: string };
    if (!id || !['Open', 'Reviewed', 'Cleared'].includes(status ?? '')) return Response.json({ error: 'A valid transaction id and status are required.' }, { status: 400 });
    const reviewedAt = status === 'Open' ? null : new Date().toISOString();
    const result = await env.DB.prepare(`UPDATE procurement_transactions SET status = ? WHERE id = ?`).bind(status, id).run();
    await env.DB.prepare(`UPDATE alerts SET status = ?, reviewed_at = ? WHERE transaction_id = ?`).bind(status, reviewedAt, id).run();
    await addAuditEvent(actorFromRequest(request), 'status_change', `Transaction ${id} marked as ${status}.`, id);
    return Response.json({ updated: result.meta.changes > 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update transaction.' }, { status: 500 });
  }
}
