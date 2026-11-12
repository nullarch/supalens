-- =====================================================================
-- saved dashboards: user-composed boards of agent-style widgets, per org.
--   dashboards          — a board (sidebar entry), soft-deletable, pinnable
--   saved_queries       — a named, re-runnable SQL against a data source
--   dashboard_widgets   — a chart placed on a board: the SAME VisualizationSpec
--                         the agent emits (chart jsonb) + a grid layout (x/y/w/h)
-- RLS mirrors data_sources: members read, member+ write (server actions use the
-- user JWT → RLS enforced). See docs/widgets-architecture.html step 6.
-- =====================================================================

-- 1. dashboards ----------------------------------------------------------
create table dashboards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  slug        text not null,
  name        text not null,
  pinned      boolean not null default false,
  position    int not null default 0,                       -- sidebar ordering
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index dashboards_org_slug_live on dashboards (org_id, slug) where deleted_at is null;
create index dashboards_org_idx on dashboards (org_id, position);
create trigger trg_dashboards_upd before update on dashboards
  for each row execute function app.set_updated_at();

-- 2. saved_queries (register_query) --------------------------------------
create table saved_queries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  data_source_id uuid references data_sources(id) on delete set null,
  name           text,
  sql            text not null,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index saved_queries_org_idx on saved_queries (org_id);
create index saved_queries_ds_idx on saved_queries (data_source_id);
create trigger trg_saved_queries_upd before update on saved_queries
  for each row execute function app.set_updated_at();

-- 3. dashboard_widgets ---------------------------------------------------
create table dashboard_widgets (
  id               uuid primary key default gen_random_uuid(),
  dashboard_id     uuid not null references dashboards(id) on delete cascade,
  org_id           uuid not null references organizations(id) on delete cascade,
  saved_query_id   uuid references saved_queries(id) on delete set null,
  data_source_id   uuid references data_sources(id) on delete set null,
  spec             jsonb not null,                           -- VisualizationSpec (validated app-side by src/lib/viz/spec.ts)
  sample           jsonb,                                    -- optional cached { columns, rows } for instant render / demo widgets
  x                int not null default 0,
  y                int not null default 0,
  w                int not null default 6,
  h                int not null default 4,
  position         int not null default 0,                   -- order fallback
  refresh_interval int,                                      -- seconds; null = manual refresh
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index dashboard_widgets_dash_idx on dashboard_widgets (dashboard_id, position);
create index dashboard_widgets_org_idx on dashboard_widgets (org_id);
create trigger trg_dashboard_widgets_upd before update on dashboard_widgets
  for each row execute function app.set_updated_at();

-- 4. RLS: members read; owner/admin/member write (mirrors ds_write) ------
alter table dashboards        enable row level security;
alter table saved_queries     enable row level security;
alter table dashboard_widgets enable row level security;
revoke all on dashboards, saved_queries, dashboard_widgets from anon;

create policy dashboards_sel on dashboards for select to authenticated
  using (org_id in (select app.current_org_ids()) and deleted_at is null);
create policy dashboards_write on dashboards for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin','member']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin','member']::org_role[]));

create policy saved_queries_sel on saved_queries for select to authenticated
  using (org_id in (select app.current_org_ids()));
create policy saved_queries_write on saved_queries for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin','member']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin','member']::org_role[]));

create policy dashboard_widgets_sel on dashboard_widgets for select to authenticated
  using (org_id in (select app.current_org_ids()));
create policy dashboard_widgets_write on dashboard_widgets for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin','member']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin','member']::org_role[]));
