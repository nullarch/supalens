-- =====================================================================
-- supalens RLS: deny-by-default + membership-based org isolation.
-- See docs/db-schema.md §5.
--   - Next.js server actions use the user JWT (authenticated) -> RLS enforced.
--   - FastAPI worker / MCP server use service_role (BYPASSRLS) + explicit org filters.
--   - secrets / keys are fully blocked from client roles (service_role only).
-- =====================================================================

-- 1. Enable RLS on every tenant table -----------------------------------
alter table organizations          enable row level security;
alter table profiles               enable row level security;
alter table organization_members   enable row level security;
alter table provider_connections   enable row level security;
alter table data_sources           enable row level security;
alter table secrets                enable row level security;
alter table data_encryption_keys   enable row level security;
alter table api_keys               enable row level security;
alter table secret_access_log      enable row level security;
alter table credential_revocations enable row level security;
alter table audit_log              enable row level security;
alter table data_source_schemas    enable row level security;
alter table data_source_objects    enable row level security;

-- 2. Secret/key tables: block client roles entirely (no policy = deny; service_role bypasses)
revoke all on secrets, data_encryption_keys, secret_access_log, api_keys,
              credential_revocations
  from anon, authenticated;
-- also keep anon out of every tenant table
revoke all on organizations, organization_members, provider_connections,
              data_sources, profiles, audit_log, data_source_schemas, data_source_objects
  from anon;

-- 3. RLS helpers (avoid recursion: SECURITY DEFINER bypasses membership policy) ----
create or replace function app.current_org_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.organization_members where user_id = (select auth.uid())
$$;

create or replace function app.has_org_role(p_org uuid, p_roles public.org_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.role = any(p_roles)
  )
$$;

grant execute on function app.current_org_ids() to authenticated;
grant execute on function app.has_org_role(uuid, public.org_role[]) to authenticated;

-- 4. Read policies (members; soft-deleted excluded) ----------------------
create policy org_sel on organizations for select to authenticated
  using (id in (select app.current_org_ids()) and deleted_at is null);

create policy om_sel on organization_members for select to authenticated
  using (org_id in (select app.current_org_ids()));

create policy pc_sel on provider_connections for select to authenticated
  using (org_id in (select app.current_org_ids()) and deleted_at is null);

create policy ds_sel on data_sources for select to authenticated
  using (org_id in (select app.current_org_ids()) and deleted_at is null);

create policy prof_sel on profiles for select to authenticated
  using (id = (select auth.uid()));

create policy prof_upd on profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy audit_sel on audit_log for select to authenticated
  using (org_id in (select app.current_org_ids()));

create policy dss_sel on data_source_schemas for select to authenticated
  using (data_source_id in (
    select id from data_sources where org_id in (select app.current_org_ids())
  ));

create policy dso_sel on data_source_objects for select to authenticated
  using (data_source_id in (
    select id from data_sources where org_id in (select app.current_org_ids())
  ));

-- 5. Write policies (WITH CHECK blocks moving a row to another org + role gate)
create policy ds_write on data_sources for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin','member']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin','member']::org_role[]));

create policy pc_write on provider_connections for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin']::org_role[]));

create policy org_write on organizations for update to authenticated
  using      (app.has_org_role(id, array['owner','admin']::org_role[]))
  with check (app.has_org_role(id, array['owner','admin']::org_role[]));

-- 6. Least-privilege reveal path: no direct SELECT, SECURITY DEFINER RPC only
--    (the Node secrets service uses the service_role client; this RPC is the
--     in-DB alternative and keeps the audit insert atomic with the read.)
create or replace function app.checkout_secret(
  p_secret_id uuid, p_purpose text, p_request_id text
) returns table(ciphertext text, dek_id text, nonce text, algo text, aad_version smallint)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select s.org_id into v_org from public.secrets s
    where s.id = p_secret_id and s.status = 'active';
  if v_org is null then
    raise exception 'secret not found or inactive';
  end if;
  insert into public.secret_access_log(secret_id, org_id, action, actor_kind, actor_id, purpose, request_id)
    values (p_secret_id, v_org, 'reveal', 'system', current_user, p_purpose, p_request_id);
  update public.secrets set last_accessed_at = now(), access_count = access_count + 1
    where id = p_secret_id;
  return query
    select s.ciphertext, s.dek_id, s.nonce, s.algo, s.aad_version
    from public.secrets s where s.id = p_secret_id and s.status = 'active';
end $$;
revoke all on function app.checkout_secret(uuid, text, text) from public, anon, authenticated;
grant execute on function app.checkout_secret(uuid, text, text) to service_role;

-- put_current_secret: demote the existing current secret + insert the new one in ONE
-- transaction (the secrets vault rotation-by-replace path). service_role only.
-- In public schema so the service-role client can call it via supabase-js .rpc().
create or replace function public.put_current_secret(
  p_id uuid, p_org_id uuid, p_data_source_id uuid, p_connection_id uuid,
  p_kind secret_kind, p_ciphertext text, p_nonce text, p_dek_id text,
  p_algo text, p_aad_version smallint,
  p_expires_at timestamptz, p_not_after timestamptz, p_created_by uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_data_source_id is not null then
    update public.secrets set is_current = false
      where data_source_id = p_data_source_id and kind = p_kind and is_current;
  else
    update public.secrets set is_current = false
      where connection_id = p_connection_id and kind = p_kind and is_current;
  end if;

  insert into public.secrets (
    id, org_id, data_source_id, connection_id, kind,
    ciphertext, nonce, dek_id, algo, aad_version,
    is_current, version, status, expires_at, not_after, created_by
  ) values (
    p_id, p_org_id, p_data_source_id, p_connection_id, p_kind,
    p_ciphertext, p_nonce, p_dek_id, p_algo, p_aad_version,
    true, 1, 'active', p_expires_at, p_not_after, p_created_by
  );
  return p_id;
end $$;
revoke all on function public.put_current_secret(
  uuid, uuid, uuid, uuid, secret_kind, text, text, text, text, smallint, timestamptz, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.put_current_secret(
  uuid, uuid, uuid, uuid, secret_kind, text, text, text, text, smallint, timestamptz, timestamptz, uuid
) to service_role;

-- 7. create_organization: authenticated bootstrap (org + owner membership) ----
create or replace function public.create_organization(p_name text, p_slug text)
returns organizations language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
        v_org public.organizations;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.organizations (name, slug) values (p_name, p_slug)
    returning * into v_org;
  insert into public.organization_members (org_id, user_id, role)
    values (v_org.id, v_uid, 'owner');
  return v_org;
end $$;
revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
