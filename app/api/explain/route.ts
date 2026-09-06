import { explainTransaction, getAuthenticatedActor, hasPermission } from '../../../lib/procurement-db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const actor = await getAuthenticatedActor(request);
    if (!actor) return Response.json({ error: 'Sign-in required.' }, { status: 401 });
    if (!hasPermission(actor.role, 'explain:read')) return Response.json({ error: 'Your role cannot view model explanations.' }, { status: 403 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'A transaction id is required.' }, { status: 400 });
    const explanation = await explainTransaction(id);
    if (!explanation) return Response.json({ error: 'Transaction not found.' }, { status: 404 });
    return Response.json({ explanation });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Explanation service unavailable.' }, { status: 503 });
  }
}
