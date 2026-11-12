-- Discord alert channel: widen the notification_channels provider CHECK.
-- `provider` is text + inline CHECK (NOT a Postgres enum), so this is a plain
-- constraint swap in one file — the two-file ALTER TYPE dance does not apply.
-- A Discord channel is one row: provider='discord', target=<webhook URL>,
-- connection_id=null (incoming webhooks need no OAuth/bot install). The URL is a
-- posting credential; the existing owner/admin-only `nc_rw` policy already hides
-- it from members (same model as org_slack_config.webhook_url).
alter table notification_channels
  drop constraint notification_channels_provider_check;
alter table notification_channels
  add constraint notification_channels_provider_check
    check (provider in ('slack', 'teams', 'email', 'webhook', 'discord'));
