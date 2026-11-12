-- =====================================================================
-- profiles.wizard_completed_at — first-login onboarding wizard state.
--
-- NULL = the user has never finished (or dismissed) the 3-act onboarding
-- wizard; a timestamp = never show it again. Per-USER (not per-org): the
-- wizard is a first-login experience, and localStorage can't carry it
-- across devices.
--
-- Self-write is intentionally allowed: prof_upd (20260629100200) already
-- grants whole-row self-UPDATE, and "marking my own wizard done" is a
-- harmless self-transition (unlike is_admin, which has a guard trigger).
-- =====================================================================

alter table profiles
  add column wizard_completed_at timestamptz;

-- Backfill: everyone who exists at deploy time predates the wizard and
-- must never see it (this project shares auth.users with the old app —
-- see the 2026-07-03 profiles-FK backfill precedent). New signups get
-- NULL via app.handle_new_user and enter the wizard.
update profiles
  set wizard_completed_at = now()
  where wizard_completed_at is null;
