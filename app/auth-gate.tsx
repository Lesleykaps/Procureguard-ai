'use client';

import { createClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { AppShell } from './app-shell';

const browserEnv = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
type BrowserSupabaseRegistry = typeof globalThis & { __procureguardSupabaseClient?: ReturnType<typeof createClient> };

// Vinext hot reload can re-evaluate this module. Keeping one client prevents
// duplicate auth listeners and stale development renders.
const registry = globalThis as BrowserSupabaseRegistry;
const supabase = registry.__procureguardSupabaseClient ??= createClient(
  browserEnv.VITE_SUPABASE_URL ?? '',
  browserEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } },
);

type SessionUser = { email: string; displayName: string };

export function AuthGate() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('admin@procureguard.demo');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const originalFetch = useRef<typeof window.fetch | null>(null);

  function setApiSession(accessToken: string | null) {
    if (!originalFetch.current) originalFetch.current = window.fetch.bind(window);
    const nativeFetch = originalFetch.current;
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!accessToken || !url.startsWith('/api/')) return nativeFetch(input, init);
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('Authorization', `Bearer ${accessToken}`);
      return nativeFetch(input, { ...init, headers });
    };
  }

  useEffect(() => {
    let active = true;
    const applySession = (session: { access_token: string; user: { email?: string; user_metadata?: { full_name?: string } } } | null) => {
      setApiSession(session?.access_token ?? null);
      if (!active) return;
      setUser(session ? { email: session.user.email ?? 'Unknown account', displayName: session.user.user_metadata?.full_name ?? session.user.email ?? 'ProcureGuard user' } : null);
      setLoading(false);
    };
    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));
    return () => { active = false; subscription.unsubscribe(); if (originalFetch.current) window.fetch = originalFetch.current; };
  }, []);

  async function signIn(event: { preventDefault: () => void }) {
    event.preventDefault(); setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError('The email address or password is incorrect.');
  }

  async function signOut() {
    await supabase.auth.signOut({ scope: 'local' });
  }

  if (loading) return <main className="min-h-screen bg-[#07131d] text-[#e7f5f7] grid place-items-center">Loading secure workspace…</main>;
  if (user) return <AppShell authenticatedUser={user} onSignOut={signOut} />;

  return (
    <main className="min-h-screen bg-[#07131d] text-[#e7f5f7] grid place-items-center p-6">
      <form onSubmit={signIn} className="w-full max-w-md rounded-2xl border border-[#1a827f] bg-[#0b1e2c] p-8 shadow-2xl">
        <p className="text-sm font-semibold text-[#2ee0d4]">PROCUREGUARD AI</p>
        <h1 className="mt-2 text-2xl font-bold">Sign in to the demonstration</h1>
        <p className="mt-2 text-sm text-[#a1bbc3]">Use one of the dissertation role accounts provided with this project.</p>
        <label className="mt-6 block text-sm">Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" className="mt-1 w-full rounded-md border border-[#315363] bg-[#07131d] p-3 text-white" required /></label>
        <label className="mt-4 block text-sm">Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" className="mt-1 w-full rounded-md border border-[#315363] bg-[#07131d] p-3 text-white" required /></label>
        {error && <p className="mt-3 text-sm text-[#ff8c9e]">{error}</p>}
        <button className="mt-6 w-full rounded-md bg-[#0dd3da] p-3 font-bold text-[#03202a] hover:bg-[#5be8e5]">Sign in</button>
      </form>
    </main>
  );
}
