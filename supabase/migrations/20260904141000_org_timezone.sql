-- Organization display timezone.
--
-- Every operator-facing timestamp in the product (monitor "last checked", incident
-- "fired at", the weekly digest window) is currently rendered as a raw UTC ISO slice —
-- `iso.slice(0, 16)` in the monitors/incidents tables. A Seoul team reading "09:12"
-- for an event that happened at 18:12 local is a real misread, so the workspace needs
-- one declared timezone that those renderers can adopt.
--
-- This is a PREFERENCE, not a billing column, so it is deliberately NOT added to
-- app.guard_org_billing_write — the org_write RLS policy (owner/admin UPDATE) is
-- allowed to write it, exactly like organizations.name and weekly_digest_enabled.
--
-- The CHECK is a shape guard only (IANA-ish "Area/Location", plus bare names like
-- "UTC"); the authoritative validation is Intl.supportedValuesOf('timeZone') in
-- src/lib/org/timezone.ts, which the server action runs before writing.
alter table organizations
  add column if not exists timezone text not null default 'UTC'
    check (timezone ~ '^[A-Za-z_]+(/[A-Za-z_+-]+)*$');

comment on column organizations.timezone is
  'IANA timezone for rendering this workspace''s timestamps (default UTC). Owner/admin-writable via org_write; not a billing column.';
