-- =====================================================================
-- Member-invitation hardening (audit 2026-07-10)
--
-- 1. profiles.email drifts from auth.users.email: app.handle_new_user only
--    fires on INSERT, so an auth email change leaves profiles stale. That
--    breaks invite_member's `already_member` check (it matches members by
--    profiles.email) and shows stale emails in list_org_members. Add an
--    UPDATE-sync trigger + a one-time resync of already-drifted rows.
--
-- 2. accept_invitation:
--    a) require a CONFIRMED email. The invite email-match check assumes the
--       account actually controls the address; an unconfirmed signup (e.g.
--       direct /auth/v1/signup with someone else's email while confirmations
--       are off) must not satisfy it. Defense-in-depth — the primary control
--       is keeping email confirmations ON in the Auth dashboard.
--    b) lock the invitation row (FOR UPDATE) so a concurrent revoke/re-invite
--       serializes against the accept instead of being silently overwritten.
-- =====================================================================

-- 1. keep profiles.email (+ display_name backfill) in sync on auth changes ---
create or replace function app.handle_user_updated()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
     set email = new.email,
         display_name = coalesce(
           display_name,
           new.raw_user_meta_data->>'full_name',
           new.raw_user_meta_data->>'name'
         )
   where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row
  when (
    old.email is distinct from new.email
    or old.raw_user_meta_data is distinct from new.raw_user_meta_data
  )
  execute function app.handle_user_updated();

-- one-time resync of rows that already drifted before the trigger existed
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;

-- 2. accept_invitation: confirmed-email requirement + row lock ---------------
create or replace function public.accept_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := (select auth.uid());
  v_email     text;
  v_confirmed timestamptz;
  v_inv       public.organization_invitations;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select email, email_confirmed_at into v_email, v_confirmed
    from auth.users where id = v_uid;

  -- lock the row: a concurrent revoke_invitation/invite_member (both UPDATE
  -- the same row) now waits for this accept instead of racing it.
  select * into v_inv from public.organization_invitations
    where token = p_token for update;
  if v_inv.id is null then raise exception 'invite_not_found'; end if;
  if v_inv.status <> 'pending' then raise exception 'invite_not_pending'; end if;
  if v_inv.expires_at < now() then raise exception 'invite_expired'; end if;
  if lower(v_inv.email) <> lower(coalesce(v_email, '')) then raise exception 'email_mismatch'; end if;
  -- the email-match check above is only meaningful if the account has proven
  -- control of that address (OAuth / verified magic-link both set this).
  if v_confirmed is null then raise exception 'email_not_confirmed'; end if;

  insert into public.organization_members (org_id, user_id, role)
    values (v_inv.org_id, v_uid, v_inv.role)
    on conflict (org_id, user_id) do nothing;

  update public.organization_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = v_uid
    where id = v_inv.id;
  return v_inv.org_id;
end $$;
revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
