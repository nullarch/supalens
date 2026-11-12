-- credential_revocations gains a structured payload (e.g. { project_ref } for
-- kind='minted_db_role') so the process-revocations task knows what to retry
-- without parsing last_error. Service-role only table; no RLS change needed.
alter table credential_revocations add column if not exists payload jsonb;
