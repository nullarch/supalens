-- Slack integration part 2 — statements that USE the enum values added in
-- 20260708100000 (a new enum value can't be used in the transaction that adds it;
-- same split as the firestore pair 20260702100000 / 20260702100100).

-- 1. Widen the secrets kind<->parent CHECK: 'slack_bot_token' is a connection-scoped
--    secret (like oauth_refresh_token). Without this, putSecret(kind='slack_bot_token',
--    parent=connection) violates the CHECK and the Slack connect flow always fails.
--    Re-uses the firestore migration's find-by-definition drop (the constraint may be
--    the named one from 20260702100100 OR a leftover unnamed original) — re-runnable.
do $$
declare cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'secrets'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%oauth_refresh_token%';
  if cname is not null then
    execute format('alter table secrets drop constraint %I', cname);
  end if;
end $$;

alter table secrets add constraint secrets_kind_parent_check check (
  -- data_source-scoped kinds
  (kind in ('db_password','ssl_client_key','provisioning_service_role','gcp_service_account')
     and data_source_id is not null and connection_id is null)
  or
  -- connection-scoped kinds (OAuth refresh token, Slack bot token)
  (kind in ('oauth_refresh_token','slack_bot_token')
     and connection_id is not null and data_source_id is null)
);

-- 2. One live Slack connection per WORKSPACE across ALL orgs (tenant boundary).
--    The existing per-(org, provider, account) unique index still allows two different
--    orgs to hold the same team_id, which would make @supalens mentions route to an
--    arbitrary org. The connect flow surfaces this as a friendly error; the index is
--    the hard guarantee. (Predicate uses the 'slack' enum value → must live in this file.)
create unique index if not exists pc_slack_team_live
  on provider_connections (external_account_id)
  where provider = 'slack' and deleted_at is null;
