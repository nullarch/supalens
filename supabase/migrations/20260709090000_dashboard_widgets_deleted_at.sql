-- dashboard_widgets was designed for soft-delete (removeWidget updates deleted_at, and the
-- widgets_per_dashboard cap counts with `.is('deleted_at', null)`), but the column was never
-- created in 20260630120000_dashboards.sql — the update errored (widget removal silently
-- failed and reappeared on reload) and the cap count errored → failed open.
alter table dashboard_widgets add column deleted_at timestamptz;

-- live widgets only in the common per-board read path
create index dashboard_widgets_live_idx on dashboard_widgets (dashboard_id, position)
  where deleted_at is null;
