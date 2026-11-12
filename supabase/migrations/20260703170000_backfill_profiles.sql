-- Profiles backfill + self-healing membership bootstrap.
--
-- Incident (2026-07-03): every /app page crashed to the error boundary for legacy users.
-- The remote DB has auth users created BEFORE the core-tenancy migration (20260629100000)
-- introduced `profiles` + the on_auth_user_created trigger. The trigger only covers NEW
-- signups and nothing backfilled the pre-existing users, so `profiles` sat empty. First
-- /app visit → ensurePrimaryOrg → create_organization → insert into organization_members
-- → FK violation (organization_members_user_id_fkey: user_id not present in profiles).
-- `organizations` was still empty at that point, so this hit 100% of legacy users.
--
-- Two layers:
--   1. Backfill profiles from auth.users (idempotent; mirrors app.handle_new_user).
--   2. app.ensure_profile(): upsert the caller's profile inside the two SECURITY DEFINER
--      RPCs that insert organization_members (create_organization, accept_invitation), so
--      a missing profile can never break membership bootstrap again (dropped trigger,
--      auth.users restored from backup, etc.).

-- 1. backfill ---------------------------------------------------------------
insert into public.profiles (id, email, display_name)
select u.id, u.email,
       coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
from auth.users u
on conflict (id) do nothing;

-- 2. self-heal helper --------------------------------------------------------
create or replace function app.ensure_profile(p_uid uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  select u.id, u.email,
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
  from auth.users u
  where u.id = p_uid
  on conflict (id) do nothing;
end $$;
-- only invoked from inside the SECURITY DEFINER RPCs below; not client-callable
revoke all on function app.ensure_profile(uuid) from public, anon, authenticated;

-- 3. create_organization: body unchanged from 20260703160000 (org-cap backstop)
--    + ensure_profile before the membership insert
create or replace function public.create_organization(p_name text, p_slug text)
returns organizations language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
        v_org public.organizations;
        v_owned int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
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

-- 4. accept_invitation: body unchanged from 20260701000000_member_management
--    + ensure_profile before the membership insert
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text;
  v_inv   public.organization_invitations;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select email into v_email from auth.users where id = v_uid;

  select * into v_inv from public.organization_invitations where token = p_token;
  if v_inv.id is null then raise exception 'invite_not_found'; end if;
  if v_inv.status <> 'pending' then raise exception 'invite_not_pending'; end if;
  if v_inv.expires_at < now() then raise exception 'invite_expired'; end if;
  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then raise exception 'email_mismatch'; end if;

  perform app.ensure_profile(v_uid);

  insert into public.organization_members (org_id, user_id, role)
    values (v_inv.org_id, v_uid, v_inv.role)
    on conflict (org_id, user_id) do nothing;

  update public.organization_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = v_uid
    where id = v_inv.id;
  return v_inv.org_id;
end $$;
