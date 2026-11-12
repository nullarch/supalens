-- =====================================================================
-- Outreach CRM — manual warm-outreach lead tracking + ref-link attribution.
--
-- Purpose: state for manual 1:1 outreach — who was contacted, on what channel,
-- whether they clicked the tracked link and whether they signed up. It never
-- sends anything. The staff tool that used the lead table is not part of this
-- repository; the tables stay so the migration history matches.
--
-- Platform-STAFF data (not per-org): gated on profiles.is_admin, NOT org roles.
-- =====================================================================

-- Reusable platform-admin predicate for RLS. SECURITY DEFINER so it reads
-- profiles.is_admin without recursing through profiles' own RLS. Mirrors the
-- is_admin flag introduced in 20260711085349.
create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
revoke all on function app.is_platform_admin() from public;
grant execute on function app.is_platform_admin() to authenticated, service_role;

-- 1. outreach_leads ----------------------------------------------------
create table public.outreach_leads (
  id            uuid primary key default gen_random_uuid(),
  ref_code      text not null unique,                       -- short code in the tracking link /r/<code>
  source        text not null default 'github:supabase/supabase',  -- provenance (audience research)
  login         text unique,                                -- github login — dedup key for import idempotency
  name          text,
  email         text,
  email_source  text,
  followers     integer not null default 0,
  twitter       text,
  website       text,
  company       text,
  location      text,
  bio           text,
  repos         text,                                       -- engaged repo(s), comma-joined
  tier          text,                                       -- follower-tier label (tier1_10k_plus, …)
  channel       text not null default 'warm_social'
                  check (channel in ('warm_social','email')),
  status        text not null default 'new'
                  check (status in ('new','queued','contacted','replied','clicked','signed_up','skip','bounced')),
  contacted_at   timestamptz,
  contacted_via  text check (contacted_via in ('twitter','linkedin','email')),
  clicked_at     timestamptz,                               -- first ref-link click
  click_count    integer not null default 0,
  converted_at   timestamptz,
  converted_user_id uuid references public.profiles(id) on delete set null,
  converted_org_id  uuid references public.organizations(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
-- CRM list is filtered by status/channel and sorted by followers (highest-intent first)
create index outreach_leads_status_idx on public.outreach_leads (status) where deleted_at is null;
create index outreach_leads_channel_idx on public.outreach_leads (channel) where deleted_at is null;
create index outreach_leads_followers_idx on public.outreach_leads (followers desc) where deleted_at is null;
create trigger trg_outreach_leads_upd before update on public.outreach_leads
  for each row execute function app.set_updated_at();

-- 2. outreach_clicks (ref-link hit ledger; no PII — visitor_hash is an HMAC) ---
create table public.outreach_clicks (
  id            uuid primary key default gen_random_uuid(),
  ref_code      text not null,
  lead_id       uuid references public.outreach_leads(id) on delete set null,
  visitor_hash  text,                                       -- HMAC(ip) — no raw IP stored (mirrors demo_requests)
  user_agent    text,                                       -- coarse client hint, truncated app-side
  referer       text,
  created_at    timestamptz not null default now()
);
create index outreach_clicks_ref_idx on public.outreach_clicks (ref_code, created_at desc);
create index outreach_clicks_created_idx on public.outreach_clicks (created_at);

-- 3. RLS ---------------------------------------------------------------
-- Leads: platform staff (is_admin) read + update; INSERT/DELETE service_role only
-- (imports + soft-deletes go through the service-role admin client / scripts).
alter table public.outreach_leads enable row level security;
revoke all on public.outreach_leads from anon;
create policy outreach_leads_sel on public.outreach_leads for select to authenticated
  using (app.is_platform_admin() and deleted_at is null);
create policy outreach_leads_upd on public.outreach_leads for update to authenticated
  using      (app.is_platform_admin())
  with check (app.is_platform_admin());

-- Clicks: service_role only. RLS enabled with NO policies (same posture as
-- demo_requests / slack_events) — the click route writes via service role, and
-- the CRM never reads raw clicks (it reads the denormalized click_count on the
-- lead), so no authenticated policy is needed.
alter table public.outreach_clicks enable row level security;
revoke all on public.outreach_clicks from anon;
