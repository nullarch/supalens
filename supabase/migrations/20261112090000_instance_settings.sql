-- =====================================================================
-- Instance settings — one row describing THIS install.
--
-- A self-hosted install is a single workspace with internal accounts: the
-- first visitor creates the owner on a one-time setup screen, after which
-- accounts are created by an admin and no further organization may exist.
-- The hosted service never sets `single_workspace`, so nothing changes there.
--
-- Enforcement lives in the database (not only in the UI) because
-- `create_organization` is callable by any signed-in user.
-- =====================================================================

create table if not exists public.instance_settings (
  id                 boolean primary key default true check (id),
  single_workspace   boolean not null default false,
  setup_completed_at timestamptz,
  updated_at         timestamptz not null default now()
);

insert into public.instance_settings (id) values (true) on conflict (id) do nothing;

-- service_role only: RLS on, no policies (same shape as the other server-only tables).
alter table public.instance_settings enable row level security;
revoke all on public.instance_settings from anon, authenticated;
grant select, update on public.instance_settings to service_role;

-- create_organization: body unchanged from 20260703170000 (org-cap backstop +
-- ensure_profile) + the single-workspace guard. The row lock serialises two
-- concurrent first-run setups: the second one sees the first one's organization
-- and is refused.
create or replace function public.create_organization(p_name text, p_slug text)
returns organizations language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
        v_org public.organizations;
        v_owned int;
        v_single boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select single_workspace into v_single
    from public.instance_settings where id for update;
  if coalesce(v_single, false)
     and exists (select 1 from public.organizations where deleted_at is null) then
    raise exception 'single_workspace';
  end if;

  -- hard anti-abuse ceiling: how many orgs does this user already OWN?
  select count(*) into v_owned
    from public.organization_members
    where user_id = v_uid and role = 'owner';
  if v_owned >= 20 then
    raise exception 'org limit reached';
  end if;

  perform app.ensure_profile(v_uid);

  insert into public.organizations (name, slug) values (p_name, p_slug)
    returning * into v_org;
  insert into public.organization_members (org_id, user_id, role)
    values (v_org.id, v_uid, 'owner');
  return v_org;
end $$;
