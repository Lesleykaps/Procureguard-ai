import { getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';
import { assertSupabase, getSupabaseServer } from '../../../lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'audit:read')) return Response.json({ error: 'Your role cannot view the audit trail.' }, { status: 403 });
    const result = await getSupabaseServer().from('audit_events').select('id, actor_id, event_type, message, created_at').order('created_at', { ascending: false }).limit(50);
    assertSupabase(result);
    return Response.json({ events: result.data ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Audit trail unavailable.' }, { status: 503 });
  }
}
