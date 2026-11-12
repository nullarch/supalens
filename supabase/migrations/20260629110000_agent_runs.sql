-- =====================================================================
-- agent_runs: one row per LLM analysis run (Claude Agent SDK on Trigger.dev).
-- The BFF inserts (queued) + triggers; the Trigger task updates status/usage.
-- =====================================================================
create type agent_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

create table agent_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  data_source_id uuid references data_sources(id) on delete set null,
  user_id        uuid references profiles(id) on delete set null,
  question       text not null,
  status         agent_run_status not null default 'queued',
  trigger_run_id text,                                 -- Trigger.dev run id (for Realtime subscribe)
  turns          int not null default 0,
  tokens_in      bigint not null default 0,
  tokens_out     bigint not null default 0,
  cost_usd       numeric(10, 4) not null default 0,
  result         jsonb,                                -- { text: ... } — no secrets
  error          text,
  created_at     timestamptz not null default now(),
  ended_at       timestamptz
);
create index agent_runs_org_idx on agent_runs (org_id, created_at desc);
create index agent_runs_ds_idx on agent_runs (data_source_id);

-- RLS: org members can read their runs; writes are service_role only (BFF + task).
alter table agent_runs enable row level security;
revoke all on agent_runs from anon;

create policy agent_runs_sel on agent_runs for select to authenticated
  using (org_id in (select app.current_org_ids()));
