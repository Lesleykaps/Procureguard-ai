import { getAuthenticatedActor } from '../../../lib/procurement-db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    return Response.json({ user: { id: actor.userId, email: actor.email, displayName: actor.displayName, role: actor.role } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Session unavailable.' }, { status: 503 });
  }
}
