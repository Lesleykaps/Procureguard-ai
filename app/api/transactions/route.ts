import { addAuditEvent, getAuthenticatedActor, hasPermission, listTransactions, seedDemoData } from '../../../lib/procurement-db';
import { assertSupabase, getSupabaseServer } from '../../../lib/supabase-server';
import { paginationFromRequest } from '../../../lib/supabase-pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'transactions:read')) return Response.json({ error: 'Your role cannot view transactions.' }, { status: 403 });
    const count = await getSupabaseServer().from('procurement_transactions').select('id', { count: 'exact', head: true });
    assertSupabase(count);
    if (!count.count) await seedDemoData(actor.userId);
    const total = count.count || 6;
    const pagination = paginationFromRequest(request);
    return Response.json({ transactions: await listTransactions(pagination.from, pagination.to), pagination: { page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)) } });
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
    const supabase = getSupabaseServer();
    const result = await supabase.from('procurement_transactions').update({ status }).eq('id', id).select('id');
    assertSupabase(result);
    const alerts = await supabase.from('alerts').update({ status, reviewed_at: reviewedAt }).eq('transaction_id', id);
    assertSupabase(alerts);
    await addAuditEvent(actor.userId, 'status_change', `Transaction ${id} marked as ${status}.`, id);
    return Response.json({ updated: (result.data ?? []).length > 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update transaction.' }, { status: 500 });
  }
}
