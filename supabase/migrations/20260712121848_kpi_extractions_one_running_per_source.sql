-- =====================================================================
-- At most ONE 'running' kpi_extraction per data source.
--
-- The app's re-trigger guard (a 'running' row younger than a TTL blocks a fresh trigger) was
-- (a) 15 min — SHORTER than the extract-kpis task's 60 min maxDuration, so a legit long tier-2 run
-- stopped blocking and got double-triggered (duplicate LLM cost + double usage increment), and
-- (b) read-then-insert racy (two simultaneous POSTs both passed the check). The code TTL is raised
-- to 60 min AND stale 'running' rows are now healed on read; this partial unique index is the
-- race-proof structural backstop, and the pre-steps one-time heal any pre-existing stuck rows.
-- =====================================================================

-- 1a) Any 'running' row older than the task maxDuration (60 min) is stuck (the task died without a
--     completion signal) → mark it failed.
update kpi_extractions
   set status = 'failed',
       error = coalesce(error, 'timed out (no completion signal)'),
       completed_at = now()
 where status = 'running'
   and created_at < now() - interval '60 minutes';

-- 1b) If a source STILL has more than one 'running', keep only the newest and fail the rest, so the
--     unique index below can be built. (created_at, id) breaks exact-timestamp ties deterministically.
update kpi_extractions e
   set status = 'failed',
       error = coalesce(error, 'superseded by a newer run'),
       completed_at = now()
 where e.status = 'running'
   and exists (
     select 1 from kpi_extractions n
      where n.data_source_id = e.data_source_id
        and n.status = 'running'
        and (n.created_at, n.id) > (e.created_at, e.id)
   );

-- 2) Enforce it structurally. createExtraction translates the resulting 23505 into a 409.
create unique index if not exists kpi_extractions_one_running_per_source
  on kpi_extractions (data_source_id)
  where status = 'running';
