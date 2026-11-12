-- =====================================================================
-- Paddle billing: webhook idempotency + transaction history.
-- Mirrors github_webhook_events (server-only dedup on a UNIQUE delivery key).
-- =====================================================================

-- Webhook idempotency: event_id (evt_…) is Paddle's per-event id. Paddle delivers
-- at-least-once and can retry, so a duplicate insert is skipped by the handler.
-- Server-only (no policy = client-deny; service_role bypasses RLS).
create table paddle_webhook_events (
  event_id    text primary key,          -- Paddle event_id (evt_…)
  event_type  text not null,             -- e.g. subscription.updated
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  status      text not null default 'received',  -- received|processed|invalid
  payload     jsonb
);
create index paddle_webhook_events_received_idx on paddle_webhook_events (received_at desc);

alter table paddle_webhook_events enable row level security;
revoke all on paddle_webhook_events from anon, authenticated;

-- Transaction history for the billing page (written from transaction.completed).
-- Members read their own org's rows; writes are service_role only (no write policy).
create table billing_transactions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id) on delete cascade,
  paddle_transaction_id  text not null,
  paddle_subscription_id text,
  status                 text,           -- completed|billed|paid|…
  amount_cents           integer,        -- smallest currency unit
  currency               text,
  billed_at              timestamptz,
  created_at             timestamptz not null default now(),
  unique (paddle_transaction_id)
);
create index billing_transactions_org_idx on billing_transactions (org_id, billed_at desc);

alter table billing_transactions enable row level security;
revoke all on billing_transactions from anon;
create policy billtx_sel on billing_transactions for select to authenticated
  using (org_id in (select app.current_org_ids()));
