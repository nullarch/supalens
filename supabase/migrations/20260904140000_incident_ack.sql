-- =====================================================================
-- Incident triage — acknowledgement, "expected" marking, root-cause feedback
-- and per-monitor snooze.
--
-- An "incident" is a FIRED alert_events row (see src/lib/alerts/incidents.ts);
-- until now the table was write-once by the runner. These columns let an operator
-- close the loop on one: acknowledge it, mark it expected, tell us whether the AI's
-- probable cause was right, and mute the monitor for a while.
--
-- RLS is deliberately UNCHANGED: alert_events stays member-READ / service_role-write
-- (`alert_events_sel` from 20260701120000). The /app/incidents server actions verify
-- membership with the user-JWT client and then write with the admin client — the same
-- shape the alert channel actions use. Adding a client write policy here would let a
-- viewer rewrite an incident's audit trail.
--
-- Every column is nullable with no default, so the app's fail-open probe
-- (incidents-server.ts) works both before and after this migration is applied.
-- =====================================================================

alter table public.alert_events
  add column if not exists acknowledged_at  timestamptz,
  add column if not exists acknowledged_by  uuid references public.profiles(id) on delete set null,
  add column if not exists ack_kind         text,
  add column if not exists cause_feedback   text,
  add column if not exists cause_correction text;

-- CHECKs are added separately (and idempotently) so re-running on a partially
-- migrated database can't fail on a duplicate constraint name.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alert_events_ack_kind_check') then
    alter table public.alert_events
      add constraint alert_events_ack_kind_check check (ack_kind in ('ack', 'expected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alert_events_cause_feedback_check') then
    alter table public.alert_events
      add constraint alert_events_cause_feedback_check
      check (cause_feedback in ('correct', 'partial', 'wrong'));
  end if;
end $$;

-- The incidents list's default view is "not yet acknowledged", newest first.
create index if not exists alert_events_open_idx
  on public.alert_events (org_id, created_at desc)
  where kind = 'fired' and acknowledged_at is null;

-- Snooze mutes ONE monitor until a wall-clock instant. The runner reads this in its own
-- best-effort query (alerts/runner.ts::filterSnoozed) so an unapplied migration degrades
-- to "nothing is snoozed" rather than stopping evaluation.
alter table public.alerts add column if not exists snoozed_until timestamptz;
