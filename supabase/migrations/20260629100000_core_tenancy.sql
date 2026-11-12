-- =====================================================================
-- supalens core tenancy: organizations, profiles, memberships
-- See docs/db-schema.md §4.1
-- =====================================================================

-- 0. extensions & helper schema (RLS helpers live in a non-API schema) ----
create extension if not exists pgcrypto;
create schema if not exists app;

-- authenticated/service_role must be able to call helper fns referenced in policies
grant usage on schema app to authenticated, service_role;

create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- 1. organizations (tenant boundary) -------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index organizations_slug_live on organizations (slug) where deleted_at is null;
create trigger trg_org_upd before update on organizations
  for each row execute function app.set_updated_at();

-- 2. profiles (mirror of auth.users) -------------------------------------
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- auto-create a profile row whenever an auth user is created
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- 3. organization_members (profile <-> org, with role) -------------------
create type org_role as enum ('owner','admin','member','viewer');
create table organization_members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       org_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on organization_members (user_id); -- 'find my orgs'
create trigger trg_om_upd before update on organization_members
  for each row execute function app.set_updated_at();
