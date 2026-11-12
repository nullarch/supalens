-- Home dashboard: the board /app/overview shows for this workspace.
--
-- NULL means "not chosen": the app falls back to the auto-KPI board (slug core-kpi), then the first
-- pinned board, then the first board. Dashboards are soft-deleted, so the ON DELETE SET NULL only
-- covers a hard delete; the resolver ignores a home id whose board has deleted_at set.
--
-- Written through the existing org_write policy (owner/admin). The billing guard trigger lists its
-- protected columns explicitly, so this column is intentionally NOT added to it — choosing the home
-- board is a workspace preference, not a billing field.
alter table public.organizations
  add column if not exists home_dashboard_id uuid references public.dashboards(id) on delete set null;
