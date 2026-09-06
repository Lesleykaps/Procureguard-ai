import { getAuthenticatedActor, hasPermission, listModelSnapshots } from '../../../lib/procurement-db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'models:read')) return Response.json({ error: 'Your role cannot view model governance.' }, { status: 403 });
    return Response.json({ models: await listModelSnapshots() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Model registry unavailable.' }, { status: 503 });
  }
}
