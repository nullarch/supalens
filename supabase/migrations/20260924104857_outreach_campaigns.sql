-- =====================================================================
-- Outreach content campaigns — tracked /r/<code> links for PUBLIC posts (an X
-- post, a Reddit thread, a blog article), next to the 1:1 lead links.
--
-- A campaign code lives in the same ref-code namespace as outreach_leads.ref_code:
-- /r/<code> logs every hit into outreach_clicks (ref_code = the campaign code,
-- lead_id stays null — no new click column needed), sets the first-touch sl_ref
-- cookie, and the signup (ensurePrimaryOrg for the first workspace, createOrg for
-- a later one) credits the campaign in outreach_campaign_conversions.
--
-- Platform-STAFF data: gated on app.is_platform_admin() (20260723102104), like the
-- lead tables. The app reads/writes through the service-role admin client.
-- =====================================================================

-- 1. outreach_campaigns ------------------------------------------------
create table public.outreach_campaigns (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique
                 check (code ~ '^[A-Za-z0-9]{6,16}$'),        -- same shape as isRefCode (lib/outreach/logic.ts)
  channel      text not null default 'x',                      -- free text: 'x', 'reddit', 'blog', …
  label        text not null,
  target_path  text not null default '/'                       -- /r/<code>?to=<path>; INTERNAL only (no open redirect)
                 check (target_path like '/%' and target_path not like '//%'),
  notes        text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz                                     -- archive (hidden from the panel; stops crediting)
);

-- 2. outreach_campaign_conversions (one signup credit per org) ----------
-- org_id deliberately has NO FK: the credit must outlive a hard-deleted org, the same
-- way outreach_leads.converted_at survives converted_org_id going null.
create table public.outreach_campaign_conversions (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.outreach_campaigns(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  org_id       uuid not null unique,
  created_at   timestamptz not null default now()
);
create index outreach_campaign_conversions_campaign_idx
  on public.outreach_campaign_conversions (campaign_id);
-- First-touch per USER as well: the sl_ref cookie outlives the first-workspace credit
-- (ensurePrimaryOrg runs in a Server Component and can't clear it), so a later
-- manually created workspace must not credit the campaign a second time.
create unique index outreach_campaign_conversions_user_uniq
  on public.outreach_campaign_conversions (user_id)
  where user_id is not null;

-- 3. RLS ---------------------------------------------------------------
-- Campaigns: platform staff read + create + update (archive); no DELETE policy.
alter table public.outreach_campaigns enable row level security;
revoke all on public.outreach_campaigns from anon;
create policy outreach_campaigns_sel on public.outreach_campaigns for select to authenticated
  using (app.is_platform_admin() and deleted_at is null);
create policy outreach_campaigns_ins on public.outreach_campaigns for insert to authenticated
  with check (app.is_platform_admin());
create policy outreach_campaigns_upd on public.outreach_campaigns for update to authenticated
  using      (app.is_platform_admin())
  with check (app.is_platform_admin());

-- Conversions: staff read; writes are service_role only (the signup attribution path).
alter table public.outreach_campaign_conversions enable row level security;
revoke all on public.outreach_campaign_conversions from anon;
create policy outreach_campaign_conversions_sel on public.outreach_campaign_conversions
  for select to authenticated
  using (app.is_platform_admin());

-- 4. Per-campaign funnel aggregate (staff panel) -------------------------
-- Aggregated in SQL rather than by pulling raw click rows: PostgREST caps a response at
-- max_rows (1000), which would silently undercount a post that takes off. Clicks come
-- from the outreach_clicks ledger (pruned at 180d — maintenance/prune.ts), so click
-- figures are a trailing-180-day window; signups / own-DB are durable. own_db_orgs =
-- credited orgs with at least one live, non-demo data source.
-- SECURITY INVOKER + service_role-only execute (it runs with service_role's BYPASSRLS).
create or replace function public.outreach_campaign_stats()
returns table (
  id              uuid,
  code            text,
  label           text,
  channel         text,
  target_path     text,
  created_at      timestamptz,
  clicks          bigint,
  unique_visitors bigint,
  signups         bigint,
  own_db_orgs     bigint
)
language sql
stable
set search_path = ''
as $$
  select
    c.id, c.code, c.label, c.channel, c.target_path, c.created_at,
    (select count(*) from public.outreach_clicks k where k.ref_code = c.code),
    (select count(distinct k.visitor_hash) from public.outreach_clicks k where k.ref_code = c.code),
    (select count(*) from public.outreach_campaign_conversions v where v.campaign_id = c.id),
    (select count(*) from public.outreach_campaign_conversions v
      where v.campaign_id = c.id
        and exists (
          select 1 from public.data_sources d
           where d.org_id = v.org_id and not d.is_demo and d.deleted_at is null
        ))
  from public.outreach_campaigns c
  where c.deleted_at is null
  order by c.created_at desc;
$$;

revoke all on function public.outreach_campaign_stats() from public, anon, authenticated;
grant execute on function public.outreach_campaign_stats() to service_role;
