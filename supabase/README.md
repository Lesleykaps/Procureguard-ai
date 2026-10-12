# Supabase setup

ProcureGuard uses a managed Supabase project; it does not need a local database.

1. Create a new Supabase project and obtain its project URL, publishable key, and server-only secret key.
2. In the Supabase SQL Editor, apply `migrations/20261002164738_initial_procureguard_schema.sql` to create the protected schema.
3. Copy `.env.example` to `.env.local` and provide the three Supabase values plus a demo password.
4. Run `pnpm run data:generate`, then `node scripts/seed-managed-dataset.mjs` and `node scripts/provision-demo-accounts.mjs`.
5. Start the app with `pnpm dev`.

The migration intentionally enables RLS and revokes direct browser table access. All data access goes through the application API, which validates Supabase sessions and application roles.
