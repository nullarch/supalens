-- Context-extraction plan policy: free = one lifetime tier-2 (code-aware, LLM) extraction
-- per org; paid = unlimited manual, with push-triggered auto-regen gated by a per-plan
-- cooldown in TS (lib/plans/limits.ts — the SSOT for the caps themselves).
--
-- The lifetime counter must NOT be derived from agent_runs (run rows are pruned on a
-- retention schedule, which would silently refill the free slot), so it lives on the org
-- row and is incremented only on a SUCCESSFUL tier-2 generation (runContextGeneration).

alter table organizations
  add column if not exists context_extractions_used integer not null default 0;

comment on column organizations.context_extractions_used is
  'Lifetime count of successful tier-2 (repo-based) context extractions. Enforced against plan limits in TS (context_extractions_total); service_role-managed via increment_context_extractions().';

-- Billing-column guard: enumerated, so the new column must be added explicitly or the
-- org_write RLS policy (owner/admin) could reset the counter and re-mint the free extraction.
create or replace function app.guard_org_billing_write()
returns trigger language plpgsql as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') and (
        new.plan                       is distinct from old.plan
     or new.subscription_status        is distinct from old.subscription_status
     or new.paddle_customer_id         is distinct from old.paddle_customer_id
     or new.paddle_subscription_id     is distinct from old.paddle_subscription_id
     or new.current_period_starts_at   is distinct from old.current_period_starts_at
     or new.current_period_ends_at     is distinct from old.current_period_ends_at
     or new.current_period_query_count is distinct from old.current_period_query_count
     or new.current_period_token_count is distinct from old.current_period_token_count
     or new.scheduled_change           is distinct from old.scheduled_change
     or new.billing_event_at           is distinct from old.billing_event_at
     or new.usage_warned_at            is distinct from old.usage_warned_at
     or new.usage_limit_reached_at     is distinct from old.usage_limit_reached_at
     or new.context_extractions_used   is distinct from old.context_extractions_used
  ) then
    raise exception 'billing columns on organizations are managed by the billing system (service_role only)';
  end if;
  return new;
end $$;

-- Atomic increment (mirrors increment_org_usage). SECURITY DEFINER so the guard trigger
-- allows it; granted to service_role only — the increment happens exclusively on the agent
-- host after a successful generation, never from a user-JWT path.
create or replace function public.increment_context_extractions(org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organizations
     set context_extractions_used = context_extractions_used + 1
   where id = org_id;
end $$;

revoke all on function public.increment_context_extractions(uuid) from public;
grant execute on function public.increment_context_extractions(uuid) to service_role;
