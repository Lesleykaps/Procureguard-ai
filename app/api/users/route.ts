import { addAuditEvent, getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { assertSupabase, getSupabaseServer } from '../../../lib/supabase-server';

export const dynamic = 'force-dynamic';

const roles = ['Admin', 'Auditor', 'Procurement Officer', 'Manager'] as const;
type ManagedRole = typeof roles[number];

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'users:read')) return Response.json({ error: 'Your role cannot view user management.' }, { status: 403 });
    const result = await getSupabaseServer().from('app_users').select('id, email, display_name, role, created_at').order('created_at', { ascending: true });
    assertSupabase(result);
    return Response.json({ users: result.data ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'User directory unavailable.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'users:manage')) return Response.json({ error: 'Your role cannot manage user access.' }, { status: 403 });
    const { id, role } = await request.json() as { id?: string; role?: string };
    if (!id || !roles.includes(role as ManagedRole)) return Response.json({ error: 'A valid user id and role are required.' }, { status: 400 });
    if (id === actor.userId) return Response.json({ error: 'You cannot change your own role.' }, { status: 400 });
    const supabase = getSupabaseServer();
    const targetResult = await supabase.from('app_users').select('id, role').eq('id', id).maybeSingle();
    assertSupabase(targetResult);
    const target = targetResult.data;
    if (!target) return Response.json({ error: 'User not found.' }, { status: 404 });
    if (target.role === 'Admin' && role !== 'Admin') {
      const adminCount = await supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('role', 'Admin');
      assertSupabase(adminCount);
      if (Number(adminCount.count ?? 0) <= 1) return Response.json({ error: 'The last Admin cannot be demoted.' }, { status: 409 });
    }
    const updated = await supabase.from('app_users').update({ role }).eq('id', id);
    assertSupabase(updated);
    await addAuditEvent(actor.userId, 'user_role_update', `User ${id} role changed from ${target.role} to ${role}.`, id);
    return Response.json({ updated: true, id, role });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update user access.' }, { status: 500 });
  }
}
