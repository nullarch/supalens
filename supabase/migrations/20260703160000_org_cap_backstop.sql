-- Org-per-user hard backstop (anti-abuse).
--
-- The daily LLM-run cap (MAX_RUNS_PER_ORG_PER_DAY) is enforced PER ORG, so each org a user owns is a
-- unit of free LLM budget — unbounded org creation would multiply it. The product limit
-- (MAX_ORGS_PER_USER, default 3) is enforced in the createOrg server action with a friendly message,
-- but that is a UI-path guard: create_organization is a SECURITY DEFINER RPC granted to `authenticated`,
-- so a direct client RPC call would bypass it. This adds the un-bypassable ceiling INSIDE the RPC.
--
-- The ceiling (20) is deliberately generous — well above the product default of 3 — so it only stops
-- egregious abuse, never a legitimately reconfigured MAX_ORGS_PER_USER. Only the owner-count check is
-- added; the rest of the function is unchanged from 20260629100200_rls_policies.sql.

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

  insert into public.organizations (name, slug) values (p_name, p_slug)
    returning * into v_org;
  insert into public.organization_members (org_id, user_id, role)
    values (v_org.id, v_uid, 'owner');
  return v_org;
end $$;
