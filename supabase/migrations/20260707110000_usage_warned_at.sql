-- Once-per-period quota-warning email marker. Compared against
-- current_period_starts_at: warned_at older than the period start means the
-- current period hasn't been warned yet. Service-role managed, so it joins the
-- guard-trigger column list (the guard enumerates columns explicitly).
alter table organizations add column if not exists usage_warned_at timestamptz;

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
  ) then
    raise exception 'billing columns on organizations are managed by the billing system (service_role only)';
  end if;
  return new;
end $$;
