-- =====================================================================
-- supalens member management: invitations + role/membership mutation RPCs
--
-- Fills the gap left by core_tenancy + rls_policies: `organization_members`
-- had only a SELECT policy (om_sel), so role changes / removals / invites were
-- impossible through the user JWT (deny-by-default). Rather than open broad
-- write policies (hard to express role hierarchy + last-owner safety in a USING
-- clause), every mutation goes through a SECURITY DEFINER RPC that enforces:
--   - the caller is a member with sufficient role (owner/admin),
--   - a strict role hierarchy (you can only touch roles strictly below yours),
--   - the last owner can never be demoted / removed / leave (org can't orphan).
-- See docs/db-schema.md §4.1, §5.
-- =====================================================================

-- 1. role-rank helper: owner > admin > member > viewer -------------------
create or replace function app.org_role_rank(p_role public.org_role)
returns int language sql immutable as $$
  select case p_role
    when 'owner'  then 3
    when 'admin'  then 2
    when 'member' then 1
    when 'viewer' then 0
  end
$$;
grant execute on function app.org_role_rank(public.org_role) to authenticated;

-- 2. invitations --------------------------------------------------------
create table organization_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text not null,
  role        org_role not null default 'member',
  token       text not null default encode(gen_random_bytes(24), 'hex'),
  status      text not null default 'pending',            -- pending | accepted | revoked
  invited_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references profiles(id) on delete set null,
  constraint org_invite_role_not_owner check (role <> 'owner'),
  constraint org_invite_status_valid   check (status in ('pending','accepted','revoked'))
);
create unique index org_invite_token on organization_invitations (token);
-- at most one live pending invite per (org, email)
create unique index org_invite_pending_email
  on organization_invitations (org_id, lower(email)) where status = 'pending';
create index org_invite_org_idx on organization_invitations (org_id);

alter table organization_invitations enable row level security;
revoke all on organization_invitations from anon;

-- owner/admin of the org may read its invitations (email is sensitive PII).
create policy oi_sel on organization_invitations for select to authenticated
  using (app.has_org_role(org_id, array['owner','admin']::org_role[]));
-- no write policy: all inserts/updates go through the RPCs below.

-- 3. reader RPC: full member roster with profile info -------------------
--    profiles.prof_sel only exposes the caller's own row, so a plain join
--    would hide co-members. This SECURITY DEFINER reader returns the roster to
--    any member of the org (and only them).
create or replace function public.list_org_members(p_org uuid)
returns table (
  user_id      uuid,
  email        text,
  display_name text,
  role         public.org_role,
  created_at   timestamptz
)
language sql stable security definer set search_path = '' as $$
  select m.user_id, pr.email, pr.display_name, m.role, m.created_at
  from public.organization_members m
  join public.profiles pr on pr.id = m.user_id
  where m.org_id = p_org
    and exists (
      select 1 from public.organization_members me
      where me.org_id = p_org and me.user_id = (select auth.uid())
    )
  order by app.org_role_rank(m.role) desc, m.created_at asc
$$;
revoke all on function public.list_org_members(uuid) from public, anon;
grant execute on function public.list_org_members(uuid) to authenticated;

-- 4. invite_member ------------------------------------------------------
create or replace function public.invite_member(
  p_org uuid, p_email text, p_role public.org_role
) returns public.organization_invitations
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_caller public.org_role;
  v_email  text := lower(trim(p_email));
  v_inv    public.organization_invitations;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if v_email = '' or position('@' in v_email) = 0 then raise exception 'invalid_email'; end if;
  if p_role = 'owner' then raise exception 'cannot_invite_owner'; end if;

  select role into v_caller from public.organization_members
    where org_id = p_org and user_id = v_uid;
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'forbidden'; end if;
  -- may only grant a role strictly below the caller's own rank
  if app.org_role_rank(p_role) >= app.org_role_rank(v_caller) then raise exception 'role_above_caller'; end if;

  if exists (
    select 1 from public.organization_members m
    join public.profiles pr on pr.id = m.user_id
    where m.org_id = p_org and lower(pr.email) = v_email
  ) then raise exception 'already_member'; end if;

  -- supersede any existing pending invite for the same email
  update public.organization_invitations set status = 'revoked'
    where org_id = p_org and lower(email) = v_email and status = 'pending';

  insert into public.organization_invitations (org_id, email, role, invited_by)
    values (p_org, v_email, p_role, v_uid)
    returning * into v_inv;
  return v_inv;
end $$;
revoke all on function public.invite_member(uuid, text, public.org_role) from public, anon;
grant execute on function public.invite_member(uuid, text, public.org_role) to authenticated;

-- 5. update_member_role -------------------------------------------------
create or replace function public.update_member_role(
  p_org uuid, p_user uuid, p_role public.org_role
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_caller public.org_role;
  v_target public.org_role;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_user = v_uid then raise exception 'cannot_change_own_role'; end if;
  if p_role = 'owner' then raise exception 'use_transfer_ownership'; end if;

  select role into v_caller from public.organization_members where org_id = p_org and user_id = v_uid;
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'forbidden'; end if;

  select role into v_target from public.organization_members where org_id = p_org and user_id = p_user;
  if v_target is null then raise exception 'not_a_member'; end if;

  -- caller must strictly outrank both the target's current role and the new role.
  -- (This also makes owners untouchable by anyone but a transfer.)
  if app.org_role_rank(v_target) >= app.org_role_rank(v_caller) then raise exception 'target_outranks_caller'; end if;
  if app.org_role_rank(p_role)  >= app.org_role_rank(v_caller) then raise exception 'role_above_caller'; end if;

  update public.organization_members set role = p_role where org_id = p_org and user_id = p_user;
end $$;
revoke all on function public.update_member_role(uuid, uuid, public.org_role) from public, anon;
grant execute on function public.update_member_role(uuid, uuid, public.org_role) to authenticated;

-- 6. remove_member ------------------------------------------------------
create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_caller public.org_role;
  v_target public.org_role;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_user = v_uid then raise exception 'use_leave_org'; end if;

  select role into v_caller from public.organization_members where org_id = p_org and user_id = v_uid;
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'forbidden'; end if;

  select role into v_target from public.organization_members where org_id = p_org and user_id = p_user;
  if v_target is null then raise exception 'not_a_member'; end if;
  if app.org_role_rank(v_target) >= app.org_role_rank(v_caller) then raise exception 'target_outranks_caller'; end if;

  delete from public.organization_members where org_id = p_org and user_id = p_user;
end $$;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- 7. leave_org (self-removal; last owner must transfer first) -----------
create or replace function public.leave_org(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_role      public.org_role;
  v_owner_cnt int;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select role into v_role from public.organization_members where org_id = p_org and user_id = v_uid;
  if v_role is null then raise exception 'not_a_member'; end if;
  if v_role = 'owner' then
    select count(*) into v_owner_cnt from public.organization_members
      where org_id = p_org and role = 'owner';
    if v_owner_cnt <= 1 then raise exception 'last_owner_must_transfer'; end if;
  end if;
  delete from public.organization_members where org_id = p_org and user_id = v_uid;
end $$;
revoke all on function public.leave_org(uuid) from public, anon;
grant execute on function public.leave_org(uuid) to authenticated;

-- 8. transfer_ownership (owner hands the crown to an existing member) ----
create or replace function public.transfer_ownership(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_caller public.org_role;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_user = v_uid then raise exception 'already_owner'; end if;
  select role into v_caller from public.organization_members where org_id = p_org and user_id = v_uid;
  if v_caller is null or v_caller <> 'owner' then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.organization_members where org_id = p_org and user_id = p_user) then
    raise exception 'not_a_member';
  end if;
  update public.organization_members set role = 'owner' where org_id = p_org and user_id = p_user;
  update public.organization_members set role = 'admin' where org_id = p_org and user_id = v_uid;
end $$;
revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

-- 9. revoke_invitation --------------------------------------------------
create or replace function public.revoke_invitation(p_invite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org    uuid;
  v_caller public.org_role;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select org_id into v_org from public.organization_invitations
    where id = p_invite and status = 'pending';
  if v_org is null then raise exception 'invite_not_found'; end if;
  select role into v_caller from public.organization_members where org_id = v_org and user_id = v_uid;
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'forbidden'; end if;
  update public.organization_invitations set status = 'revoked' where id = p_invite;
end $$;
revoke all on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- 10. accept_invitation (invitee accepts via token; email must match) ---
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

  insert into public.organization_members (org_id, user_id, role)
    values (v_inv.org_id, v_uid, v_inv.role)
    on conflict (org_id, user_id) do nothing;

  update public.organization_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = v_uid
    where id = v_inv.id;
  return v_inv.org_id;
end $$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
