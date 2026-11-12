-- =====================================================================
-- Paddle billing: subscription + metered-usage state on organizations.
--
-- Model: FLAT tiered subscriptions (Paddle charges the flat fee) + the app
-- meters queries/tokens per billing cycle and enforces plan quotas. There is
-- no native Paddle usage metering — see docs/paddle-billing-plan.md §0.
--
-- All billing columns are SERVICE-ROLE managed (webhooks + the agent host).
-- The existing `org_write` RLS policy lets owner/admin UPDATE organizations
-- (rename), so without a guard they could self-set plan='premium'. RLS is
-- row-level; the column-level guard below enforces "billing = service_role only".
-- =====================================================================

alter table organizations
  add column plan                       plan_tier   not null default 'free',
  add column subscription_status        text,                    -- Paddle: active|trialing|past_due|paused|canceled (null on free)
  add column paddle_customer_id         text,
  add column paddle_subscription_id     text,
  add column current_period_starts_at   timestamptz,
  add column current_period_ends_at     timestamptz,
  add column current_period_query_count integer     not null default 0,
  add column current_period_token_count bigint      not null default 0,
  add column scheduled_change           jsonb;                   -- mirrors Paddle scheduled_change {action, effective_at}

create index organizations_paddle_sub_idx  on organizations (paddle_subscription_id) where paddle_subscription_id is not null;
create index organizations_paddle_cust_idx on organizations (paddle_customer_id)     where paddle_customer_id is not null;

-- Column-level guard: block owner/admin (the org_write policy) from mutating any
-- billing column. service_role (webhook direct writes) + postgres/supabase_admin
-- (migrations + the SECURITY DEFINER increment fn) are allowed; authenticated is not.
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
  ) then
    raise exception 'billing columns on organizations are managed by the billing system (service_role only)';
  end if;
  return new;
end $$;

create trigger trg_org_billing_guard before update on organizations
  for each row execute function app.guard_org_billing_write();
