-- =====================================================================
-- Run-history hardening (audit 2026-07-13):
--
-- 1. In-flight dedupe unique index — createAgentRun's SELECT-then-INSERT
--    double-submit guard is a TOCTOU race: two concurrent identical submits
--    both pass the SELECT and insert two runs (= double LLM cost + double
--    billing). A partial unique index makes the guard atomic; the code path
--    catches 23505 and returns `duplicate` (same contract as the window check).
--
-- 2. Retention-scan indexes — the nightly prune (src/lib/maintenance/prune.ts)
--    deletes on a bare timestamp predicate, but every growth table's date
--    index led with another column (org_id / alert_id / installation_id), so
--    each prune was a full scan that degrades as history accumulates. Add a
--    plain btree on exactly the prune predicate column per RETENTION entry.
--    (audit_log / secret_access_log use `at`; paddle uses `received_at`;
--    lifecycle_email_log uses `sent_at` — prune.ts column fixes ship together.)
-- =====================================================================

-- --- 1. in-flight dedupe -------------------------------------------------

-- Clear any pre-existing in-flight duplicates so the unique index can build:
-- keep the newest of each (org, source, question) group, fail the rest
-- (same terminal shape the stuck-run reaper uses).
with ranked as (
  select id,
         row_number() over (
           partition by org_id, data_source_id, md5(question)
           order by created_at desc
         ) as rn
  from agent_runs
  where status in ('queued', 'running')
)
update agent_runs
   set status = 'failed',
       error = 'superseded duplicate (dedupe index backfill)',
       ended_at = now()
 where id in (select id from ranked where rn > 1);

-- md5(question): `question` is up to 4000 chars — index the hash, not the text.
create unique index if not exists agent_runs_inflight_uniq
  on agent_runs (org_id, data_source_id, md5(question))
  where status in ('queued', 'running');

-- --- 2. retention-scan indexes (one per prune predicate) -----------------

create index if not exists agent_runs_created_idx            on agent_runs (created_at);
create index if not exists code_analysis_runs_created_idx    on code_analysis_runs (created_at);
create index if not exists alert_events_created_idx          on alert_events (created_at);
create index if not exists github_webhook_events_created_idx on github_webhook_events (created_at);
create index if not exists slack_events_created_idx          on slack_events (created_at);
create index if not exists paddle_webhook_events_recv_idx    on paddle_webhook_events (received_at);
create index if not exists audit_log_at_idx                  on audit_log (at);
create index if not exists secret_access_log_at_idx          on secret_access_log (at);
create index if not exists lifecycle_email_log_sent_idx      on lifecycle_email_log (sent_at);
create index if not exists credential_revocations_created_idx on credential_revocations (created_at);
