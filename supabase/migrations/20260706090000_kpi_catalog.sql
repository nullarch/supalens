-- =====================================================================
-- Auto-KPI catalog: repo/schema-driven KPI proposals + extraction runs.
-- Design: docs/auto-kpi-plan.md.
--
--   kpi_catalog     — one proposed/accepted KPI per (data_source, key). Each row is a
--                     proven-runnable metric: metric_sql + full VisualizationSpec (viz_spec,
--                     incl. a persisted sample for instant previews) + optional alert_config
--                     + code/table evidence. `status` drives the review -> apply lifecycle.
--   kpi_extractions — one extraction agent run (tier-1 schema-only / tier-2 code x DB).
--
-- Both are member-read; INSERTs are service_role only (the agent host writes proposals),
-- mirroring data_source_context (member-read / service_role-write). kpi_catalog additionally
-- lets member+ UPDATE, but a BEFORE UPDATE guard trigger (mirror of app.guard_org_billing_write)
-- restricts non-service roles to the status / applied columns — the review UI accepts /
-- dismisses; it can never rewrite a proposal's SQL, chart, or evidence.
-- =====================================================================

-- 1. kpi_catalog ---------------------------------------------------------
create table kpi_catalog (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  data_source_id uuid not null references data_sources(id) on delete cascade,
  extraction_id  uuid,                                       -- the kpi_extractions run that proposed it
  key            text not null,                              -- stable snake_case slug, unique per source
  title          text not null,
  category       text not null check (category in ('growth','revenue','engagement','ops','funnel','custom')),
  description    text,
  importance     smallint not null default 3 check (importance between 1 and 5),
  metric_sql     text not null,                              -- proven-runnable via executeReadOnly at proposal time
  viz_spec       jsonb not null,                             -- full VisualizationSpec (incl. sample for preview)
  alert_config   jsonb,                                      -- optional KpiAlertConfig -> alerts row at apply time
  evidence       jsonb not null default '[]'::jsonb,         -- [{kind:'file'|'table'|'event', ref, note?}]
  status         text not null default 'proposed' check (status in ('proposed','accepted','dismissed','stale')),
  applied        jsonb,                                      -- {dashboardId, widgetId, savedQueryId, alertId} once accepted
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (data_source_id, key)
);
create index kpi_catalog_ds_status_idx on kpi_catalog (data_source_id, status);
create trigger trg_kpi_catalog_upd before update on kpi_catalog
  for each row execute function app.set_updated_at();

-- BEFORE UPDATE guard: non-service roles may only change status / applied.
-- Mirror of app.guard_org_billing_write — the kpi_catalog_upd RLS policy grants owner/admin/
-- member UPDATE, but every column EXCEPT status/applied (and updated_at, set by the trigger
-- above) is immutable to authenticated. service_role (the agent host upserts proposals) and
-- postgres/supabase_admin (migrations) are exempt.
create or replace function app.guard_kpi_catalog_write()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') and (
        new.id             is distinct from old.id
     or new.org_id         is distinct from old.org_id
     or new.data_source_id is distinct from old.data_source_id
     or new.extraction_id  is distinct from old.extraction_id
     or new.key            is distinct from old.key
     or new.title          is distinct from old.title
     or new.category       is distinct from old.category
     or new.description    is distinct from old.description
     or new.importance     is distinct from old.importance
     or new.metric_sql     is distinct from old.metric_sql
     or new.viz_spec       is distinct from old.viz_spec
     or new.alert_config   is distinct from old.alert_config
     or new.evidence       is distinct from old.evidence
     or new.created_at     is distinct from old.created_at
  ) then
    raise exception 'kpi_catalog rows are managed by the extraction system; authenticated may only change status/applied';
  end if;
  return new;
end $$;

create trigger trg_kpi_catalog_guard before update on kpi_catalog
  for each row execute function app.guard_kpi_catalog_write();

-- 2. kpi_extractions -----------------------------------------------------
create table kpi_extractions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  data_source_id uuid not null references data_sources(id) on delete cascade,
  status         text not null default 'running' check (status in ('running','completed','failed')),
  tier           smallint not null default 1 check (tier in (1, 2)),  -- 1 = schema-only, 2 = code x DB
  proposed_count int,
  error          text,
  trigger_run_id text,                                       -- Trigger.dev run id (observability)
  created_by     uuid,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index kpi_extractions_ds_created_idx on kpi_extractions (data_source_id, created_at desc);

-- 3. RLS -----------------------------------------------------------------
alter table kpi_catalog     enable row level security;
alter table kpi_extractions enable row level security;
revoke all on kpi_catalog, kpi_extractions from anon;

-- read: any org member (mirror data_source_context dsc_sel)
create policy kpi_catalog_sel on kpi_catalog for select to authenticated
  using (org_id in (select app.current_org_ids()));

-- update: member+ (owner/admin/member) — the guard trigger above scopes WHICH columns.
-- No INSERT/DELETE policy for authenticated => service_role only (the agent host writes).
create policy kpi_catalog_upd on kpi_catalog for update to authenticated
  using      (app.has_org_role(org_id, array['owner','admin','member']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin','member']::org_role[]));

-- extractions are read-only to members; the service-role host inserts/updates them
create policy kpi_extractions_sel on kpi_extractions for select to authenticated
  using (org_id in (select app.current_org_ids()));
