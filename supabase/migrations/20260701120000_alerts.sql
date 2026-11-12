-- =====================================================================
-- supalens alerts: registered SQL-condition monitors + firing history.
--
-- Design (see the alerts architecture note): an alert stores a scalar metric
-- query (metric_sql → one numeric value) plus a comparison (operator, threshold).
-- Evaluation is deliberately TYPE-AGNOSTIC — threshold and change-rate alerts
-- both reduce to "run metric_sql, compare the scalar" — so the runner never needs
-- the LLM. The `type` column is a UI/semantics label only.
--
-- Evaluation runs in a Trigger.dev scheduled task via the service-role client, so
-- alert_events are written with BYPASSRLS; clients only ever READ. Alert mutation
-- is gated to member+ (owner/admin/member, NEVER viewer) — matching data_sources'
-- ds_write policy — because a viewer able to author an alert is a data-exfil path.
-- =====================================================================

create type alert_type   as enum ('threshold', 'change_rate');
create type alert_status as enum ('normal', 'firing');
create type alert_op     as enum ('lt', 'lte', 'gt', 'gte', 'eq', 'neq');

create table alerts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  data_source_id uuid not null references data_sources(id) on delete cascade,
  name           text not null,
  description    text,
  type           alert_type not null default 'threshold',   -- label only; eval is type-agnostic
  metric_sql     text not null,                              -- SELECT returning ONE numeric scalar
  saved_query_id uuid references saved_queries(id) on delete set null,
  operator       alert_op not null,
  threshold      double precision not null,
  enabled        boolean not null default true,

  -- evaluation state (written by the service-role runner)
  status            alert_status not null default 'normal',
  last_checked_at   timestamptz,
  last_value        double precision,
  last_error        text,                                    -- last eval failure (query error etc.)
  last_fired_at     timestamptz,
  last_notified_at  timestamptz,
  consecutive_fires int not null default 0,                  -- for hysteresis
  fire_threshold    int not null default 1,                  -- N consecutive true → fire
  cooldown_seconds  int not null default 3600,               -- min gap between notifications

  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index alerts_org_idx on alerts (org_id) where deleted_at is null;
-- the runner's "due for evaluation" scan: enabled, not deleted, by data source
create index alerts_due_idx on alerts (data_source_id, last_checked_at)
  where enabled and deleted_at is null;
create trigger trg_alerts_upd before update on alerts
  for each row execute function app.set_updated_at();

-- firing / resolve history + notification audit (append-only, runner-written)
create table alert_events (
  id         uuid primary key default gen_random_uuid(),
  alert_id   uuid not null references alerts(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  kind       text not null check (kind in ('fired', 'resolved')),
  value      double precision,
  message    text,
  notified   boolean not null default false,
  created_at timestamptz not null default now()
);
create index alert_events_alert_idx on alert_events (alert_id, created_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────
alter table alerts        enable row level security;
alter table alert_events  enable row level security;
revoke all on alerts, alert_events from anon;

-- read: any org member
create policy alerts_sel on alerts for select to authenticated
  using (org_id in (select app.current_org_ids()) and deleted_at is null);

-- write: member+ (owner/admin/member) — NEVER viewer. WITH CHECK blocks moving a
-- row to another org, exactly like data_sources' ds_write.
create policy alerts_write on alerts for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin','member']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin','member']::org_role[]));

-- events are read-only to members; only the service-role runner inserts them
-- (no INSERT/UPDATE policy for authenticated = deny; service_role bypasses).
create policy alert_events_sel on alert_events for select to authenticated
  using (org_id in (select app.current_org_ids()));
