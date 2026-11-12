-- Public-demo rate-limit ledger (docs/public-demo-plan.md). One row per LIVE anonymous run
-- created via /api/demo/ask — cache hits insert nothing. No PII: ip_hash is an HMAC of the
-- visitor IP, cookie_id is a random opaque id. service_role only: RLS enabled with NO
-- policies (same posture as slack_events). Pruned after 7 days (maintenance/prune.ts).
create table public.demo_requests (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  cookie_id text not null,
  question text not null,
  run_id uuid references public.agent_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.demo_requests enable row level security;

-- per-visitor sliding-window counts
create index demo_requests_ip_recent on public.demo_requests (ip_hash, created_at desc);
create index demo_requests_cookie_recent on public.demo_requests (cookie_id, created_at desc);
-- global daily budget count + retention prune both scan by age alone
create index demo_requests_created_at on public.demo_requests (created_at);
