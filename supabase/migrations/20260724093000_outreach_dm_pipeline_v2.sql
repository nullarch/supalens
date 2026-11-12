-- =====================================================================
-- Outreach DM pipeline v2 — research-driven refinements (2026-07-24 X-DM sweep).
--
-- followed_at: the follow-before-DM stage (following first ≈ 4x reply rate per the
--   43.7M-DM dataset). A queued lead is followed on day 1 (followed_at stamped) and
--   DM'd from day 2 — no new status value; 'queued' covers both stages so the click
--   advance / funnel logic is untouched.
-- dm_variant: which opener copy was sent (deterministic per-lead assignment), so the
--   existing click/conversion tracking doubles as an A/B readout per variant.
-- =====================================================================

alter table public.outreach_leads add column if not exists followed_at timestamptz;
alter table public.outreach_leads add column if not exists dm_variant text;
