-- =====================================================================
-- Paddle proxy subscription gateway: sibling products of the same legal
-- entity sell recurring subscriptions through
-- supalens's Paddle account. Subscription-first model:
--   proxy_partners      — partner credentials + callback config
--   proxy_products      — partner SKU → Paddle catalog price
--   proxy_subscriptions — durable entity (status mirror + period + watermark)
--   proxy_transactions  — one row per Paddle transaction (initial + renewals)
--   proxy_callbacks     — outbox: exactly-once enqueue, at-least-once delivery
-- ALL tables are service-role only (enable RLS + revoke + no policy),
-- mirroring paddle_webhook_events.
-- =====================================================================

create table proxy_partners (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  code             text not null unique,           -- slug; stamped into checkout custom_data
  api_key          text not null unique,           -- pk_live_… / pk_test_…, sent as X-API-Key
  api_key_previous text unique,                    -- rotation window: old key stays valid until cleared
  api_secret       text not null,                  -- signs partner callbacks (HMAC-SHA256)
  callback_url     text,
  allowed_origins  text[] not null default '{}',   -- exact origin allowlist for success/fail URLs
  is_test          boolean not null default false, -- sandbox partner: allows http://localhost origins + callbacks
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table proxy_products (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references proxy_partners(id) on delete cascade,
  sku             text not null,                   -- partner-facing id, e.g. plus_month
  paddle_price_id text not null unique,            -- unique: reverse-routes any price to ONE partner product
  kind            text not null default 'subscription',  -- 'one_time' reserved for later
  is_active       boolean not null default true,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  unique (partner_id, sku)
);

create table proxy_subscriptions (
  id                       uuid primary key default gen_random_uuid(),  -- partner-facing subscription ref
  partner_id               uuid not null references proxy_partners(id) on delete cascade,
  product_id               uuid not null references proxy_products(id),
  partner_user_id          text not null,          -- partner's own user id, echoed on every callback
  partner_order_id         text,                   -- partner's checkout idempotency key
  customer_email           text,
  status                   text not null default 'pending',
      -- pending | trialing | active | past_due | paused | canceled | abandoned
  paddle_subscription_id   text unique,
  paddle_customer_id       text,
  paddle_checkout_txn_id   text unique,            -- the initial checkout transaction (?_ptxn=)
  current_period_starts_at timestamptz,
  current_period_ends_at   timestamptz,
  scheduled_change         jsonb,
  canceled_at              timestamptz,
  billing_event_at         timestamptz,            -- ordering watermark (mirrors organizations.billing_event_at)
  success_url              text not null,
  fail_url                 text not null,
  metadata                 jsonb not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (partner_id, partner_order_id)
);
create index proxy_subscriptions_partner_idx on proxy_subscriptions (partner_id, created_at desc);
create index proxy_subscriptions_partner_user_idx on proxy_subscriptions (partner_id, partner_user_id);

create table proxy_transactions (
  id                       uuid primary key default gen_random_uuid(),
  partner_id               uuid not null references proxy_partners(id) on delete cascade,
  subscription_id          uuid references proxy_subscriptions(id) on delete set null,
  paddle_transaction_id    text not null unique,
  paddle_subscription_id   text,
  kind                     text not null default 'renewal',  -- initial | renewal
  status                   text not null,                    -- completed | refunded | chargeback
  amount_cents             integer,                          -- Paddle smallest-unit (KRW is zero-decimal)
  currency                 text,
  billing_period_starts_at timestamptz,
  billing_period_ends_at   timestamptz,
  billed_at                timestamptz,
  created_at               timestamptz not null default now()
);
create index proxy_transactions_subscription_idx on proxy_transactions (subscription_id, billed_at desc);

create table proxy_callbacks (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references proxy_partners(id) on delete cascade,
  subscription_id uuid references proxy_subscriptions(id) on delete cascade,
  event           text not null,                   -- proxy.subscription.{activated|renewed|past_due|canceled|refunded}
  dedupe_key      text not null unique,            -- Paddle event_id → exactly-once enqueue across webhook re-claims
  payload         jsonb not null,                  -- frozen envelope body (signed at delivery time)
  status          text not null default 'pending', -- pending | delivered | failed
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index proxy_callbacks_pending_idx on proxy_callbacks (next_attempt_at) where status = 'pending';

alter table proxy_partners      enable row level security;
alter table proxy_products      enable row level security;
alter table proxy_subscriptions enable row level security;
alter table proxy_transactions  enable row level security;
alter table proxy_callbacks     enable row level security;
revoke all on proxy_partners      from anon, authenticated;
revoke all on proxy_products      from anon, authenticated;
revoke all on proxy_subscriptions from anon, authenticated;
revoke all on proxy_transactions  from anon, authenticated;
revoke all on proxy_callbacks     from anon, authenticated;
