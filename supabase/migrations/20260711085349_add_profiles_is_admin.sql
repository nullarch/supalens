-- =====================================================================
-- profiles.is_admin — platform-staff flag (supalens staff, NOT an org role).
--
-- Distinct from the per-(user,org) organization_members.role enum
-- (owner/admin/member/viewer): is_admin is a GLOBAL per-user attribute used to
-- unlock staff-only affordances in the product (e.g. the in-product "how is this
-- metric computed" SQL debug panel on dashboards). Defaults false; the flip is
-- reserved to service_role/migrations (see the guard trigger below).
-- =====================================================================

alter table profiles
  add column is_admin boolean not null default false;

-- Self-escalation guard. The prof_upd RLS policy (20260629100200_rls_policies.sql)
-- grants authenticated users a whole-row self-UPDATE (the language switcher relies on
-- it to write profiles.locale). Without this trigger a user could simply
-- `update profiles set is_admin = true where id = auth.uid()`. Mirror
-- app.guard_org_billing_write: allow the is_admin flip only from service_role /
-- postgres / supabase_admin (migrations + service-role writes), while leaving the
-- existing name/locale self-edits untouched.
create or replace function app.guard_profile_admin_write()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin')
     and new.is_admin is distinct from old.is_admin then
    raise exception 'profiles.is_admin is managed by supalens staff tooling (service_role only)';
  end if;
  return new;
end $$;

create trigger trg_profile_admin_guard before update on profiles
  for each row execute function app.guard_profile_admin_write();
