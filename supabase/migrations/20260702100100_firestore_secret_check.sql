-- Firestore connector — allow the 'gcp_service_account' secret kind to attach to a data_source.
-- Runs AFTER 20260702100000_firestore_enums.sql has committed (so the new enum value is usable).
--
-- The secrets kind<->parent CHECK is defined INLINE (unnamed) in 20260629100100_integrations.sql,
-- so Postgres auto-named it. The `secrets` table has two unnamed CHECKs, so we must NOT guess the
-- generated name — instead find the kind<->parent one by its definition (it is the only CHECK that
-- mentions 'oauth_refresh_token'), drop it, and re-add the widened version. This is re-runnable.

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
  -- data_source-scoped kinds (now incl. Firestore's service-account JSON)
  (kind in ('db_password','ssl_client_key','provisioning_service_role','gcp_service_account')
     and data_source_id is not null and connection_id is null)
  or
  -- connection-scoped kinds
  (kind = 'oauth_refresh_token'
     and connection_id is not null and data_source_id is null)
);
