# Supabase setup

ProcureGuard uses a managed Supabase project; it does not need a local database.

1. Create a new Supabase project in the Supabase account you want to own this dissertation system. Obtain its project URL, publishable key, and server-only secret key from that new project.
2. In the Supabase SQL Editor, apply `migrations/20261002164738_initial_procureguard_schema.sql` to create the protected schema.
3. Copy `.env.example` to `.env.local` and provide the new project's three Supabase values plus a demo password. Use the same URL for `SUPABASE_URL` and `VITE_SUPABASE_URL`.
4. Run `pnpm install`, then `pnpm run data:generate`, `node scripts/seed-managed-dataset.mjs`, and `node scripts/provision-demo-accounts.mjs`.
5. Start the app with `pnpm dev`, then validate the installation with `pnpm test:validation`.

The migration intentionally enables RLS and revokes direct browser table access. All data access goes through the application API, which validates Supabase sessions and application roles.
