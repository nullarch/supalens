-- Optional per-org Slack incoming-webhook for alert notifications. The webhook URL can post to the
-- channel, so it's owner/admin-only (members can't read it); the service-role runner reads it to send.
create table org_slack_config (
  org_id      uuid primary key references organizations(id) on delete cascade,
  webhook_url text not null,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_slack_upd before update on org_slack_config
  for each row execute function app.set_updated_at();

alter table org_slack_config enable row level security;
-- owner/admin only for BOTH read and write (no member SELECT — the webhook is a posting credential)
create policy slack_rw on org_slack_config for all to authenticated
  using      (app.has_org_role(org_id, array['owner','admin']::org_role[]))
  with check (app.has_org_role(org_id, array['owner','admin']::org_role[]));
