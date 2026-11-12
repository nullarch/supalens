-- =====================================================================
-- supalens Slack integration: connect a Slack workspace (bot install via
-- OAuth v2), route notifications through a provider-neutral channel table,
-- and dedupe inbound Events API deliveries. Mirrors the github_integration
-- and alerts_slack patterns. See docs/slack.md.
--
-- The Slack workspace is stored as a provider_connection (provider='slack'),
-- with the Slack team_id in the existing external_account_id column (no new
-- column). The bot token is a per-tenant secret → vault (secret_kind=
-- 'slack_bot_token', parent=connection), NEVER a column here.
-- =====================================================================

-- 1. enum extensions. The secrets kind<->parent CHECK must be widened to accept
--    'slack_bot_token' as a connection-scoped kind — that CHECK references the new
--    enum value, so it lives in the NEXT migration file (20260708100100), exactly
--    like the firestore split (20260702100000 / 20260702100100): a new enum value
--    can't be used in the same transaction that adds it.
alter type provider_kind add value if not exists 'slack';
alter type secret_kind   add value if not exists 'slack_bot_token';

-- 2. notification_channels — provider-NEUTRAL routing target for alerts.
--    Deliberately not Slack-specific: 'teams'/'email'/'webhook' extend by value,
--    not by a new table (so a future Teams connector adds an adapter, not schema).
--    `target` = slack channel id / teams conversation ref / email addr; `config`
--    holds provider-specific extras. `connection_id` is the bot to post through.
create table notification_channels (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  provider      text not null check (provider in ('slack','teams','email','webhook')),
  target        text not null,
  label         text,
  connection_id uuid references provider_connections(id) on delete set null,
  config        jsonb not null default '{}'::jsonb,
  enabled       boolean not null default true,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index notification_channels_org_idx on notification_channels (org_id) where deleted_at is null;
create trigger trg_nc_upd before update on notification_channels
  for each row execute function app.set_updated_at();

revoke all on notification_channels from anon;
alter table notification_channels enable row level security;
-- owner/admin only for read AND write (a channel is a posting route — align with
-- org_slack_config; members don't manage where org alerts are delivered)
create policy nc_rw on notification_channels for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin']::org_role[]));

-- 3. slack_events — inbound Events API delivery idempotency. Slack retries a
--    delivery (X-Slack-Retry-*) until it gets a 200, so the events webhook records
--    event_id here and no-ops on a repeat (prevents double agent runs / double
--    billing). Registered in maintenance/prune.ts RETENTION (growth table).
create table slack_events (
  event_id   text primary key,
  org_id     uuid references organizations(id) on delete set null,
  created_at timestamptz not null default now()
);
-- service_role only: written by the events webhook, never client-read.
-- RLS on + no authenticated policy = zero row access; the explicit revoke is the
-- repo-standard defense-in-depth (mirrors github_webhook_events / paddle_webhook_events).
revoke all on slack_events from anon, authenticated;
alter table slack_events enable row level security;
