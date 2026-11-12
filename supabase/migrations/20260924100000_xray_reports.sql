-- X-ray (/x): public, no-signup reports on PUBLIC GitHub repositories. One row = one scan of
-- one commit in one locale; the row is also the rate-limit ledger (ip_hash / cookie_id) and the
-- cache (a succeeded row for the same owner/repo/commit/locale is served instead of a new run).
--
-- Anonymous surface → service_role only: RLS enabled with NO policies (same posture as
-- demo_requests / slack_events). Pages read through the admin client and only ever expose
-- succeeded, un-hidden rows. No PII: ip_hash is an HMAC of the visitor IP, cookie_id a random id.
create table public.xray_reports (
  id uuid primary key default gen_random_uuid(),
  owner text not null check (owner = lower(owner)),
  repo text not null check (repo = lower(repo)),
  full_name text not null,
  default_branch text,
  commit_sha text,
  locale text not null default 'en',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  report jsonb,
  score smallint,
  grade text,
  file_count integer,
  error_code text,
  trigger_run_id text,
  ip_hash text not null,
  cookie_id text not null,
  cost_usd numeric(10, 4),
  tokens_in integer,
  tokens_out integer,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

alter table public.xray_reports enable row level security;

-- report page + cache lookup: newest scan of a repo first
create index xray_reports_repo_recent on public.xray_reports (owner, repo, created_at desc);
-- global daily budget + "recently X-rayed" gallery
create index xray_reports_created_at on public.xray_reports (created_at desc);
-- per-visitor sliding windows
create index xray_reports_ip_recent on public.xray_reports (ip_hash, created_at desc);
create index xray_reports_cookie_recent on public.xray_reports (cookie_id, created_at desc);
-- at most ONE in-flight scan per repo + locale: a second visitor joins the running scan instead
-- of paying for a duplicate (the insert fails with 23505 and the API reads the live row).
create unique index xray_reports_one_inflight on public.xray_reports (owner, repo, locale)
  where status in ('queued', 'running');
