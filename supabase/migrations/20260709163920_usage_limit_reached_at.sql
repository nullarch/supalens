-- Once-per-period "monthly query limit reached" email marker (the upgrade email,
-- X2). Distinct from usage_warned_at (the 80% warning, X1): a user crosses 80%
-- first (warned), then later reaches 100% (reached) — two separate emails need
-- two separate watermarks. Compared against current_period_starts_at, same as
-- usage_warned_at. Service-role managed → joins the guard-trigger column list.
alter table organizations add column if not exists usage_limit_reached_at timestamptz;

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
  ) then
    raise exception 'billing columns on organizations are managed by the billing system (service_role only)';
  end if;
  return new;
end $$;
