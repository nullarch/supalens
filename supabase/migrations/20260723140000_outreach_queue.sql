-- =====================================================================
-- Outreach daily queue — the "50/day working batch" surface.
--
-- A daily Trigger.dev cron promotes the highest-intent `new` leads into
-- status='queued' (topping the working queue up to a target). queued_at marks
-- when a lead entered a day's batch, so the admin queue panel can show the
-- current batch newest-first. Nothing else changes: 'queued' already exists in
-- the status CHECK (20260723102104), and the founder still works each lead 1:1
-- (Twitter/LinkedIn warm DM) — this is a state surface, NOT a bulk emailer.
-- =====================================================================

alter table public.outreach_leads add column if not exists queued_at timestamptz;

-- The queue panel reads status='queued' and the cron top-up counts it; a partial
-- index keeps both cheap as the lead table grows toward the full import.
create index if not exists outreach_leads_queued_idx
  on public.outreach_leads (queued_at desc)
  where status = 'queued' and deleted_at is null;
