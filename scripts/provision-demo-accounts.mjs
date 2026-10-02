import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const config = await readFile('.env.local', 'utf8');
const value = (key) => config.split(/\r?\n/).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1);
const url = value('SUPABASE_URL');
const secret = value('SUPABASE_SECRET_KEY');
const password = value('DEMO_ACCOUNT_PASSWORD');
if (!url || !secret?.startsWith('sb_secret_') || !password || password.length < 12) throw new Error('A server-only Supabase key and a 12+ character DEMO_ACCOUNT_PASSWORD are required.');
const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const accounts = [
  ['admin@procureguard.demo', 'ProcureGuard Administrator', 'Admin'],
  ['auditor@procureguard.demo', 'Dissertation Auditor', 'Auditor'],
  ['manager@procureguard.demo', 'Procurement Manager', 'Manager'],
  ['officer@procureguard.demo', 'Procurement Officer', 'Procurement Officer'],
];
const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (users.error) throw users.error;
for (const [email, displayName, role] of accounts) {
  let user = users.data.users.find((candidate) => candidate.email === email);
  if (!user) {
    const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: displayName } });
    if (created.error) throw created.error;
    user = created.data.user;
  }
  const profile = await supabase.from('app_users').upsert({ id: user.id, email, display_name: displayName, role }, { onConflict: 'id' });
  if (profile.error) throw profile.error;
  process.stdout.write(`Provisioned ${role}: ${email}\n`);
}
