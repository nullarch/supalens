-- Weekly AI digest becomes OPT-IN per workspace.
--
-- Before: the digest was auto-on for EVERY paid org and fanned out one email PER active
-- data source (weekly-digest-cron → one child run per source → one email per source per
-- owner/admin). An org with many sources — e.g. a Supabase account whose every project
-- auto-provisions a data_source — got an inbox bomb every Monday, plus one LLM run per
-- source on the house. The runner is being rewritten to send ONE consolidated email per
-- org; this flag makes the feature default-OFF so nobody is opted in silently.
--
-- Owner/admin toggles it in Settings. This is a PREFERENCE, not a billing column, so it is
-- deliberately NOT added to app.guard_org_billing_write — the org_write RLS policy
-- (owner/admin UPDATE) is allowed to write it, same as organizations.name.
alter table organizations
  add column if not exists weekly_digest_enabled boolean not null default false;

comment on column organizations.weekly_digest_enabled is
  'Opt-in master switch for the weekly AI digest email (default off). Owner/admin-writable via org_write; not a billing column.';
