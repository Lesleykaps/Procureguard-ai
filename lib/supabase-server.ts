import { createClient } from '@supabase/supabase-js';

/**
 * Server-only managed database client. API routes are the sole callers: the
 * browser never receives this secret and public table access remains blocked.
 */
export function getSupabaseServer() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey || secretKey === 'replace-with-your-server-only-supabase-secret-key') {
    throw new Error('Managed database is not configured. Copy .env.example to .env.local and set SUPABASE_URL and SUPABASE_SECRET_KEY.');
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function assertSupabase(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(`Managed database request failed: ${result.error.message}`);
}
