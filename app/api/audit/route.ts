import { env } from 'cloudflare:workers';
import { getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'audit:read')) return Response.json({ error: 'Your role cannot view the audit trail.' }, { status: 403 });
    const result = await env.DB.prepare(`SELECT id, actor_id, event_type, message, created_at FROM audit_events ORDER BY created_at DESC LIMIT 50`).all();
    return Response.json({ events: result.results ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Audit trail unavailable.' }, { status: 503 });
  }
}
