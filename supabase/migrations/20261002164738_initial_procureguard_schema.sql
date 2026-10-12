-- ProcureGuard AI initial managed-database schema.
-- This application uses server-side API routes with a Supabase secret key.
-- Browser clients receive only the publishable key and have no direct table access.

create table if not exists public.app_users (
  id text primary key,
  email text not null unique,
  display_name text not null,
  role text not null check (role in ('Admin', 'Auditor', 'Procurement Officer', 'Manager')),
  created_at timestamptz not null default now()
);

create table if not exists public.procurement_transactions (
  id text primary key,
  supplier text not null,
  amount numeric not null check (amount >= 0),
  pattern text not null,
  risk_score integer not null check (risk_score between 0 and 100),
  status text not null check (status in ('Open', 'Reviewed', 'Cleared')),
  reason text not null,
  source_file text,
  model_features_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id text primary key,
  transaction_id text not null references public.procurement_transactions(id),
  risk_level text not null check (risk_level in ('High', 'Medium', 'Low')),
  status text not null check (status in ('Open', 'Reviewed', 'Cleared')),
  assigned_to text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.audit_events (
  id text primary key,
  actor_id text,
  event_type text not null,
  message text not null,
  entity_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.model_snapshots (
  id text primary key,
  name text not null,
  version text not null,
  accuracy numeric not null,
  false_positive_rate numeric not null,
  is_approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.scan_runs (
  id text primary key,
  actor_id text,
  records_scanned integer not null check (records_scanned >= 0),
  flagged_count integer not null check (flagged_count >= 0),
  high_risk_count integer not null default 0,
  medium_risk_count integer not null default 0,
  low_risk_count integer not null default 0,
  missing_feature_count integer not null default 0,
  mean_risk numeric not null,
  max_risk integer not null check (max_risk between 0 and 100),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.review_decisions (
  id text primary key,
  transaction_id text not null references public.procurement_transactions(id),
  actor_id text not null,
  decision text not null check (decision in ('confirmed_fraud', 'false_positive', 'needs_evidence')),
  review_type text not null default 'initial' check (review_type in ('initial', 'resolution')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.model_releases (
  id text primary key,
  name text not null,
  version text not null,
  status text not null check (status in ('candidate', 'approved', 'active', 'retired', 'rejected')),
  artifact_json jsonb not null,
  metrics_json jsonb not null,
  source text not null,
  submitted_by text not null,
  approved_by text,
  approved_at timestamptz,
  activated_by text,
  activated_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_alerts_status on public.alerts(status);
create index if not exists idx_alerts_transaction_id on public.alerts(transaction_id);
create index if not exists idx_transactions_created_at on public.procurement_transactions(created_at desc);
create index if not exists idx_scan_runs_created_at on public.scan_runs(created_at desc);
create index if not exists idx_review_decisions_transaction_id on public.review_decisions(transaction_id);
create index if not exists idx_review_decisions_created_at on public.review_decisions(created_at desc);
create index if not exists idx_model_releases_status on public.model_releases(status);
create index if not exists idx_model_releases_created_at on public.model_releases(created_at desc);

alter table public.app_users enable row level security;
alter table public.procurement_transactions enable row level security;
alter table public.alerts enable row level security;
alter table public.audit_events enable row level security;
alter table public.model_snapshots enable row level security;
alter table public.scan_runs enable row level security;
alter table public.review_decisions enable row level security;
alter table public.model_releases enable row level security;

-- No anon/authenticated policies are created: access is mediated by the app's
-- authenticated server routes, which enforce ProcureGuard role permissions.
revoke all on table public.app_users, public.procurement_transactions, public.alerts,
  public.audit_events, public.model_snapshots, public.scan_runs,
  public.review_decisions, public.model_releases from anon, authenticated;
