import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await env.DB.prepare(`SELECT id, actor_id, event_type, message, created_at FROM audit_events ORDER BY created_at DESC LIMIT 50`).all();
    return Response.json({ events: result.results ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Audit trail unavailable.' }, { status: 503 });
  }
}
