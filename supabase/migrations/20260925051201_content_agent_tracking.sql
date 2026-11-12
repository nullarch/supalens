-- =====================================================================
-- content-agent tracking — first-party variant attribution + business-event outbox
--
-- content-agent (the separate content-ops system) appends ca_variant (a saved-variant
-- UUID) and utm_id (campaign UUID) to its tracked links (→ /r/<code>?to=…). The /r
-- route stores them in a first-touch sl_cav cookie; when an org is created the cookie
-- becomes a content_agent_attribution row, and every confirmed business event
-- (signup, own_db_connected, subscription_payment, refund) is written to
-- content_agent_outbox with the org's variant — then POSTed by the
-- content-agent-outbox-cron Trigger task (lib/content-agent/sweep.ts).
--
-- Both tables are service_role only (RLS enabled, NO policies — same posture as
-- outreach_clicks / slack_events): written by the org-creation / connect / Paddle
-- paths and read by the cron, all through the service-role admin client.
-- =====================================================================

-- 1. content_agent_attribution (first-touch variant per org) ----------
create table public.content_agent_attribution (
  org_id       uuid primary key references public.organizations(id) on delete cascade,
  variant_id   uuid not null,
  campaign_id  uuid,
  captured_at  timestamptz not null,                  -- when the visitor clicked the tracked link
  created_at   timestamptz not null default now()
);

-- 2. content_agent_outbox (durable delivery queue) ----------------------
-- event_id is the ingress idempotency key: the FIRST enqueue wins (insert-or-ignore), so a
-- replayed trigger can never re-mint an id or change a delivered payload. org_id has NO FK:
-- an event that already happened outlives its org.
create table public.content_agent_outbox (
  id               uuid primary key default gen_random_uuid(),
  event_id         text not null unique check (char_length(event_id) between 1 and 200),
  name             text not null check (name ~ '^[a-z][a-z0-9_]*$'),
  org_id           uuid,
  payload          jsonb not null,                    -- the final event JSON, sent verbatim
  attempts         integer not null default 0,        -- failed delivery attempts (drives the backoff)
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz,                       -- set only on HTTP 200
  failed_at        timestamptz                        -- needs a human (ingress rejected the single event);
                                                      -- never auto-retried — requeue = set failed_at null
);
-- The sweep's due query: undelivered, not parked, next_attempt_at <= now(), oldest first.
create index content_agent_outbox_due_idx
  on public.content_agent_outbox (next_attempt_at, created_at)
  where delivered_at is null and failed_at is null;

-- 3. RLS: service_role only ------------------------------------------------
alter table public.content_agent_attribution enable row level security;
revoke all on public.content_agent_attribution from anon, authenticated;

alter table public.content_agent_outbox enable row level security;
revoke all on public.content_agent_outbox from anon, authenticated;
