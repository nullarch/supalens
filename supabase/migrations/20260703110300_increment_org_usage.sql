-- =====================================================================
-- Paddle billing: atomic metered-usage increment.
--
-- Replaces the orphan remote-drift function of the same name (it appears in the
-- generated types but is in NO migration and had no backing columns). The
-- backing columns were added in the org_billing migration. SECURITY DEFINER so
-- the agent host (service_role) AND user-JWT server actions can meter race-free;
-- the org_billing guard trigger allows it because the definer runs as postgres.
-- =====================================================================

-- Drop any pre-existing overloads of these function names (the remote has orphan
-- "drift" copies with an unknown signature — present in the generated types but in
-- no migration). Dropping by name (all overloads) instead of guessing the argument
-- types guarantees PostgREST can resolve the new call unambiguously.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('increment_org_usage', 'get_plan_team_limit')
  loop
    execute 'drop function ' || r.sig::text;  -- RESTRICT: fail loudly if anything unexpectedly depends on it
  end loop;
end $$;
-- get_plan_team_limit is intentionally NOT recreated — plan caps now live in TS (lib/plans/limits.ts).

create or replace function public.increment_org_usage(
  org_id uuid,
  query_increment integer default 0,
  token_increment bigint default 0
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organizations
     set current_period_query_count = current_period_query_count + coalesce(query_increment, 0),
         current_period_token_count = current_period_token_count + coalesce(token_increment, 0)
   where id = org_id;
end $$;

revoke all on function public.increment_org_usage(uuid, integer, bigint) from public;
grant execute on function public.increment_org_usage(uuid, integer, bigint) to service_role, authenticated;
