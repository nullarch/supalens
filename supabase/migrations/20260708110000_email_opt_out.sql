-- Per-member email opt-out flags (anti-spam compliance: CAN-SPAM / Gmail-Yahoo
-- bulk-sender rules require a working unsubscribe for recurring mail).
--
-- Lives on organization_members (NOT profiles) because the digest/alert
-- subscription is per-org: a user can keep the digest for org A and drop it
-- for org B. Billing/dunning mail is transactional and has no opt-out.
--
-- Writes go through the service-role client only (the one-click unsubscribe
-- route verifies an HMAC token; the settings UI goes through an authed server
-- action) — organization_members has no client write policy, unchanged.
alter table organization_members
  add column email_digest_opt_out boolean not null default false,
  add column email_alert_opt_out  boolean not null default false;
