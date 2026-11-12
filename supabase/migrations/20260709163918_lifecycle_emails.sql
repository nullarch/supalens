-- Lifecycle / activation email program: consent flag + send ledger.
--
-- These are the onboarding-nudge emails ("connect your database", "ask your
-- first question") keyed to product state by a daily Trigger.dev sweep. They are
-- INSTRUCTIONAL (정보성) — helping a user finish the service they signed up for —
-- so they run under an opt-OUT model like the digest, NOT the marketing opt-in.
--
-- Consent lives on organization_members (mirrors email_digest_opt_out /
-- email_alert_opt_out, 20260708110000). Writes are service-role only (the
-- one-click unsubscribe route verifies an HMAC token) — no client write policy.
alter table organization_members
  add column email_lifecycle_opt_out boolean not null default false;

-- Idempotency + frequency-cap ledger. The unique (user_id, dedupe_key) is THE
-- never-double-send guarantee: a one-shot nudge sets dedupe_key = kind (sendable
-- exactly once, ever); a recurring nudge sets dedupe_key = kind || ':' || week.
-- Keyed on user_id (not org) because onboarding is a PERSON's experience — one
-- sequence per human even if they created several workspaces.
create table lifecycle_email_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        text not null,            -- 'activate_try_demo' | 'activate_connect_source' | 'activate_first_query' | ...
  dedupe_key  text not null,            -- one-shot: = kind ; recurring: kind || ':' || <iso week>
  sent_at     timestamptz not null default now(),
  unique (user_id, dedupe_key)          -- claim-before-send races here → never double-fires
);
create index lifecycle_email_log_user_sent_idx on lifecycle_email_log (user_id, sent_at desc);
create index lifecycle_email_log_org_idx on lifecycle_email_log (org_id, sent_at desc);

-- service_role writes (the sweep runs on the Trigger host via the admin client);
-- members may read their own org's ledger. No client write policy (service_role
-- BYPASSRLS), mirroring the run/event tables (agent_runs, alert_events).
alter table lifecycle_email_log enable row level security;
revoke all on lifecycle_email_log from anon;
create policy lifecycle_email_log_sel on lifecycle_email_log for select to authenticated
  using (org_id in (select app.current_org_ids()));
