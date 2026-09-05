import { listModelSnapshots } from '../../../lib/procurement-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json({ models: await listModelSnapshots() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Model registry unavailable.' }, { status: 503 });
  }
}
