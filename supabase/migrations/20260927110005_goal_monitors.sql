-- =====================================================================
-- Goal monitors — "set a goal, not a threshold" (docs/goal-monitors-plan.md).
--
-- A monitor used to be one SQL scalar compared to a hand-picked number. A goal monitor splits
-- that into three parts:
--
--   goal       the operator's own words ("tell me when signups dip") — shown as the headline
--   metric_sql a SERIES query (bucket first column, measure last column, oldest → newest)
--   condition  a structured, versioned rule evaluated over that series by pure code
--              (src/lib/alerts/condition.ts): anomaly (direction-aware z-score over a bounded
--              trailing window), relative (% vs the trailing average) or absolute (a number the
--              user actually gave). Keeping the rule structured — not buried in SQL — is what
--              makes the approval-time backtest possible, and later, suggested condition tweaks.
--
-- `condition IS NULL` keeps the legacy behaviour exactly (scalar threshold / legacy anomaly), so
-- every existing monitor is untouched. The legacy columns are still written for goal monitors
-- (type label + operator/threshold/sensitivity placeholders) so older readers keep working.
--
-- RLS is deliberately UNCHANGED: `alerts_sel` / `alerts_write` already cover the new columns
-- (member read, member+ write — never viewer).
-- =====================================================================

alter table public.alerts
  add column if not exists goal      text,
  add column if not exists condition jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alerts_goal_len_check') then
    alter table public.alerts
      add constraint alerts_goal_len_check check (goal is null or char_length(goal) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alerts_condition_object_check') then
    alter table public.alerts
      add constraint alerts_condition_object_check
      check (condition is null or jsonb_typeof(condition) = 'object');
  end if;
end $$;

-- ── agent_runs.channel += 'monitor' ─────────────────────────────────────
-- A goal → monitor draft is an agent run like any other (same BFF, quota gate, task, metering),
-- labelled so the /app/ask history does not list drafting runs as questions.
alter table public.agent_runs drop constraint if exists agent_runs_channel_check;
alter table public.agent_runs
  add constraint agent_runs_channel_check
  check (channel in ('web', 'slack', 'mcp', 'incident', 'digest', 'system', 'monitor'));
