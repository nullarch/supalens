-- =====================================================================
-- supalens GitHub integration: connect a GitHub App installation, track
-- repositories, record code-analysis runs, log webhook deliveries.
-- Mirrors the provider_connections / agent_runs patterns. See docs/github.md.
--
-- v1 stores NO tenant secret for GitHub: clone uses installation tokens minted
-- on demand from the App private key (env, host-only). The only per-tenant datum
-- is the non-secret installation_id.
-- =====================================================================

-- 1. provider enum: add github. Only the COLUMN type changes here; the value
--    itself is referenced at runtime (insert), never in this migration — so the
--    "can't use a new enum value in the same tx" caveat does not apply.
alter type provider_kind add value if not exists 'github';

-- 2. provider_connections: GitHub App installation id (non-secret).
--    One live provider_connection per installation.
alter table provider_connections add column if not exists installation_id bigint;
create unique index if not exists pc_installation_live
  on provider_connections (installation_id)
  where installation_id is not null and deleted_at is null;

-- 3. Connected repositories (NOT data_sources — repos aren't SQL hosts) ------
create table github_repositories (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  connection_id    uuid not null,
  github_repo_id   bigint not null,                 -- GitHub numeric id (rename-safe)
  full_name        text   not null,                 -- "owner/repo"
  default_branch   text   not null default 'main',
  is_private       boolean not null default true,
  clone_url        text,                            -- https://github.com/owner/repo.git
  analysis_enabled boolean not null default true,   -- auto-analyze on push
  sparse_paths     text[],                          -- monorepo: dirs to analyze (optional)
  last_synced_sha  text,
  last_pushed_at   timestamptz,
  status           text   not null default 'active',-- active | disabled | error
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (id, org_id),                              -- composite FK backing
  -- only same-org connection (block cross-tenant). Destructive -> RESTRICT.
  constraint github_repositories_connection_fk
    foreign key (connection_id, org_id)
    references provider_connections (id, org_id) on delete restrict
);
create unique index github_repositories_repo_live on github_repositories (org_id, github_repo_id)
  where deleted_at is null;
create index github_repositories_conn_idx on github_repositories (connection_id);
create index github_repositories_org_active_idx on github_repositories (org_id)
  where status = 'active' and deleted_at is null;
create trigger trg_ghrepo_upd before update on github_repositories
  for each row execute function app.set_updated_at();

-- 4. Code-analysis runs (mirror of agent_runs) ------------------------------
create type code_run_status as enum ('queued','running','succeeded','failed','cancelled');

create table code_analysis_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  repo_id        uuid references github_repositories(id) on delete set null,
  data_source_id uuid references data_sources(id) on delete set null, -- combined code×DB run
  user_id        uuid references profiles(id) on delete set null,     -- null for push-triggered
  kind           text not null default 'manual',  -- manual | push | full | combined
  status         code_run_status not null default 'queued',
  trigger_run_id text,                            -- Trigger.dev run id (Realtime subscribe)
  ref            text,                            -- refs/heads/main
  before_sha     text,
  after_sha      text,
  turns          int    not null default 0,
  tokens_in      bigint not null default 0,
  tokens_out     bigint not null default 0,
  cost_usd       numeric(10,4) not null default 0,
  result         jsonb,                           -- structured findings — no secrets
  error          text,
  created_at     timestamptz not null default now(),
  ended_at       timestamptz
);
create index code_analysis_runs_org_idx  on code_analysis_runs (org_id, created_at desc);
create index code_analysis_runs_repo_idx on code_analysis_runs (repo_id);

-- 5. Webhook deliveries (idempotency + audit) -------------------------------
create table github_webhook_events (
  id              uuid primary key default gen_random_uuid(),
  delivery_id     text not null,                  -- X-GitHub-Delivery (idempotency key)
  event_type      text not null,                  -- X-GitHub-Event
  installation_id bigint,
  repo_full_name  text,
  org_id          uuid,                           -- set when mapped to a tenant
  run_id          uuid references code_analysis_runs(id) on delete set null,
  status          text not null default 'received', -- received|skipped|triggered|invalid
  created_at      timestamptz not null default now(),
  unique (delivery_id)
);
create index github_webhook_events_inst_idx on github_webhook_events (installation_id, created_at desc);

-- 6. RLS --------------------------------------------------------------------
alter table github_repositories   enable row level security;
alter table code_analysis_runs    enable row level security;
alter table github_webhook_events enable row level security;

-- webhook events are server-only (no policy = deny for client roles; service_role bypasses)
revoke all on github_webhook_events from anon, authenticated;
revoke all on github_repositories, code_analysis_runs from anon;

-- github_repositories: members read; owner/admin/member write (ds_write pattern,
-- so members can toggle analysis_enabled). WITH CHECK blocks moving a row cross-org.
create policy ghrepo_sel on github_repositories for select to authenticated
  using (org_id in (select app.current_org_ids()) and deleted_at is null);
create policy ghrepo_write on github_repositories for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin','member']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin','member']::org_role[]));

-- code_analysis_runs: members read; writes are service_role only (BFF + task)
create policy code_runs_sel on code_analysis_runs for select to authenticated
  using (org_id in (select app.current_org_ids()));
