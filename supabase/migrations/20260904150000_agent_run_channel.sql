-- =====================================================================
-- agent_runs.channel — which surface produced a run.
--
-- Until now the only distinguishable origin was "user_id IS NULL" (a Slack
-- mention or slash command, which has no supalens user), so the run history
-- could not tell an MCP call from a web question, and a root-cause
-- investigation had no row at all. This column names the surface explicitly:
--
--   web       the /app/ask composer + the public demo (the BFF path)
--   slack     an @supalens mention or the /supalens slash command
--   mcp       the MCP `ask` tool (Claude Code / Cursor / Codex)
--   incident  a root-cause investigation fired by a firing monitor
--   digest    a system summarization run (weekly digest); see the note below
--   system    any other internal run
--
-- NULL is the historical value and reads as 'web' in the UI — existing rows
-- keep working untouched, and every writer sets the column only when it
-- exists (create-run.ts retries the insert without it on 42703), so this
-- migration can land after the code without breaking run creation.
--
-- 'digest' is reserved but UNUSED today: the weekly digest deliberately runs
-- without an agent_runs row so it is not metered against the org's quota
-- (src/lib/digest/generate.ts). Giving it rows is a billing change, not a
-- labelling one — the value exists so that change needs no second migration.
--
-- RLS is deliberately UNCHANGED: agent_runs stays member-READ /
-- service_role-write (`agent_runs_sel` from 20260629110000).
-- =====================================================================

alter table public.agent_runs add column if not exists channel text;

-- Added separately + idempotently so a re-run on a partially migrated
-- database cannot fail on a duplicate constraint name.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agent_runs_channel_check') then
    alter table public.agent_runs
      add constraint agent_runs_channel_check
      check (channel in ('web', 'slack', 'mcp', 'incident', 'digest', 'system'));
  end if;
end $$;

-- The run history filters "investigations only" (channel = 'incident') inside one
-- org, newest first. Partial: incident runs are a small slice of the table.
create index if not exists agent_runs_channel_idx
  on public.agent_runs (org_id, created_at desc)
  where channel is not null and channel <> 'web';
