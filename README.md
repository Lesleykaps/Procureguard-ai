# ProcureGuard AI

ProcureGuard AI is a dissertation prototype for explainable procurement-fraud risk monitoring. It combines role-based review workflows, evidence exports, human-label governance, and a locally runnable model-scoring interface.

## Run on another machine

1. Install Node.js 22 or later and pnpm.
2. Clone the repository, then run `pnpm install`.
3. Copy `.env.example` to `.env.local` and add the existing Supabase project URL, publishable key, server-only secret key, and `DEMO_ACCOUNT_PASSWORD`.
4. Start the application with `pnpm dev`, then open `http://localhost:5173`.
5. Sign in with a provisioned demonstration account. The role accounts are `admin@procureguard.demo`, `auditor@procureguard.demo`, `manager@procureguard.demo`, and `officer@procureguard.demo`; they share the password stored in `.env.local`.

The project uses a managed Supabase database, not a local database. To create a fresh Supabase project, follow [supabase/README.md](supabase/README.md). The initial database migration is versioned in `supabase/migrations`.

## Verification

Run these checks after configuration:

```text
pnpm exec tsc --noEmit
pnpm test:validation
```

The validation command signs in through Supabase and verifies the full API workflow. It intentionally creates small validation records, review decisions, audit events, and a temporary model-governance candidate before rolling back to the baseline release.

## Data and evaluation scope

The supplied 12,000-row procurement dataset is synthetic and is suitable for prototype development and controlled demonstrations only. The optional Kaggle credit-card benchmark is kept separate from the procurement model; it demonstrates the imbalance-handling method and must not be reported as procurement-fraud accuracy. See [ml/README.md](ml/README.md) for methods, limits, and commands.

## Security model

The browser uses a Supabase publishable key solely for authentication. Procurement tables have RLS enabled and browser roles have no direct table permissions. Every data operation goes through the server API, which validates the session and checks the ProcureGuard role.
