# Paddle Billing — Implementation Plan (supalens)

Cold, implementation-ready plan for subscriptions + webhooks + metered quotas on the NEW
supalens codebase. Sources: live Paddle developer docs (fetched 2026-07-03) + a codebase
integration map. Every non-obvious codebase claim is cited `file:line`.

---

## 0. The one cold truth that shapes everything

**Paddle Billing has NO native usage-metering ingestion endpoint.** There is nothing like
Stripe's usage records / meter events. The `paddle.com/billing/metered-billing` marketing page
describes a **"Subscription Modifiers API" which is a Paddle _Classic_ concept that does not
exist in Paddle Billing** (verified: `developer.paddle.com/get-started/how-paddle-works/saas`,
`developer.paddle.com/changelog/2026/metrics-api` — "Metrics API does not support metered billing
at this moment"). Paddle even partners with an external metering vendor (m3ter) for true
usage-based pricing.

So "구독 후 metered" must be built as:

> **Flat tiered recurring subscription (Paddle just charges the flat fee) + the APP meters usage
> per billing cycle and enforces quotas (block / prompt upgrade at the cap).**

This is what Paddle's own SaaS guidance recommends. If we
ever want to bill real money for overage, that is a _later, optional_ add via one-time charges
(`POST /subscriptions/{id}/charge` with `effective_from: next_billing_period`) — NOT part of v1.

**Decision baked into this plan:** flat tiers + app-enforced quota. Overage billing deferred.

---

## 1. Product / catalog decisions

- **Use Paddle _Billing_** (current since Aug 2023), NOT Classic. Base URLs `api.paddle.com`
  (prod) / `sandbox-api.paddle.com`. `Paddle-Version: 1` header.
- **Merchant of Record**: Paddle calculates/collects/remits VAT/sales tax and issues invoices.
  → **we build ZERO tax logic**; we display a price, Paddle adds buyer-appropriate tax at checkout.
- **KR market bonus**: Paddle Billing added **KakaoPay & NaverPay recurring** (Nov 2025) — enable
  them in the dashboard for Korean customers.
- **Tiers** (reuse the old SSOT numbers unless product says otherwise): `free $0`, `basic $29`,
  `standard $99`, `premium $299`, each monthly + yearly. Prices are **pre-created catalog
  Products/Prices** in the Paddle dashboard; we store their `pri_…` IDs in config.

### Plan limits (SSOT lives in TypeScript, not the DB)

| limit | free | basic $29 | standard $99 | premium $299 |
|---|---|---|---|---|
| `queries_per_month` (hard meter) | 15 | 500 | 5,000 | ∞ |
| `tokens_per_month` (cost meter) | 15K | 500K | 5M | ∞ |
| `database_connections` | 1 | 3 | 10 | ∞ |
| `team_members` | 1 | 5 | 15 | ∞ |
| `dashboards` | 1 | 5 | 10 | ∞ |
| `widgets_per_dashboard` | 5 | 20 | 50 | ∞ |
| `alerts_per_org` | 1 | 10 | 50 | ∞ |
| `integrations_per_org` | 1 | 3 | 10 | ∞ |
| `alert_min_check_interval` (s) | 7200 | 600 | 300 | 60 |
| `query_history_days` | 7 | 30 | 90 | 365 |

`-1 = unlimited`. Unknown/unsubscribed plan → falls back to `free`.

---

## 2. Data model (new migrations)

`organizations` today is **greenfield for billing** — only `id, name, slug, created_at,
updated_at, deleted_at` (`supabase/migrations/20260629100000_core_tenancy.sql:21-28`,
`schema.type.ts:1315-1322`). No plan/usage/customer columns, no billing tables.

> **Orphan-RPC note:** `increment_org_usage(org_id, query_increment, token_increment)` and
> `get_plan_team_limit(plan_name)` appear in `schema.type.ts:1697-1709` but exist ONLY on the
> remote DB (drift from commit `765b0ef`), with **no migration, no backing columns, zero callers**.
> Treat them as a spec hint and **recreate `increment_org_usage` properly**; drop
> `get_plan_team_limit` in favor of the TS limits table.

**Enum-first gotcha** (`supabase/migrations/20260702100000_firestore_enums.sql:4-8`): a new enum
value can't be used in the same transaction that creates it → the `plan` enum goes in its OWN
migration before anything references it.

- **M1 — enum** (`..._billing_plan_enum.sql`): `CREATE TYPE plan_tier AS ENUM
  ('free','basic','standard','premium');`
- **M2 — org billing + usage columns** (`..._org_billing.sql`):
  - `plan plan_tier NOT NULL DEFAULT 'free'`
  - `subscription_status text` (Paddle: `active|trialing|past_due|paused|canceled`; null on free)
  - `paddle_customer_id text`, `paddle_subscription_id text`
  - `current_period_starts_at timestamptz`, `current_period_ends_at timestamptz`
  - `current_period_query_count int NOT NULL DEFAULT 0`
  - `current_period_token_count bigint NOT NULL DEFAULT 0`
  - `scheduled_change jsonb` (mirror Paddle's `{action, effective_at}` for "cancels on <date>")
  - indexes on `paddle_subscription_id`, `paddle_customer_id`
  - RLS: members **read** their org's billing columns; **only service_role writes** (all billing
    state is webhook/agent-host authored).
- **M3 — webhook idempotency** (`..._paddle_webhook_events.sql`): `paddle_webhook_events(event_id
  text PRIMARY KEY, event_type text, occurred_at timestamptz, received_at timestamptz DEFAULT
  now(), payload jsonb)`. Mirrors `github_webhook_events` dedup.
- **M4 — usage increment fn** (`..._increment_org_usage.sql`): recreate atomically —
  `UPDATE organizations SET current_period_query_count = current_period_query_count + p_query,
  current_period_token_count = current_period_token_count + p_token WHERE id = p_org;` as
  `SECURITY DEFINER` so a user-JWT server action AND the service-role host can both call it
  race-free.
- **M5 (optional, for the billing UI history)** — `billing_transactions(id, org_id,
  paddle_transaction_id unique, amount_cents int, currency text, status text, billed_at
  timestamptz)`, written from `transaction.completed`.
- Run `npm run db:types` after applying (CLAUDE.md rule).

---

## 3. Config + env (mirror the GitHub App pattern)

Create `src/lib/paddle/config.ts` `getPaddleConfig()` modeled on `getGithubAppConfig()`
(`src/lib/github-app/config.ts:26-47`) — a plain `process.env` reader that throws if unset,
and **NOT `import 'server-only'`** (billing usage-increment code is shared with the Trigger.dev
runtime, same convention as `src/utils/supabase/admin.ts:1-5`).

Env split (add a sectioned block to `.env.example` like the GitHub block at `:22-45`):

- **Vercel / BFF**: `PADDLE_API_KEY` (`pdl_live_apikey_…` / `pdl_sdbx_apikey_…`, backend-only),
  `PADDLE_WEBHOOK_SECRET` (`pdl_ntfset_…`), `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (`live_…`/`test_…`,
  safe in the browser), `NEXT_PUBLIC_PADDLE_ENVIRONMENT` (`sandbox|production`), and the price-ID map
  (`PADDLE_PRICE_ID_BASIC=pri_…`, etc.).
- **Trigger.dev host**: **nothing new** — usage increment reuses the existing
  `SUPABASE_SERVICE_ROLE_KEY`, exactly like `persistRun`.

Never put Paddle secrets in `src/config/server.ts` (it's `server-only` and holds no secrets by
design, `:8-19`).

---

## 4. Checkout flow (client)

`npm install @paddle/paddle-js @paddle/paddle-node-sdk`.

1. Pricing/Upgrade page (client component):
   ```ts
   const paddle = await initializePaddle({
     environment: process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT, // 'sandbox' | 'production'
     token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
   })
   paddle.Checkout.open({
     items: [{ priceId: PRICE_IDS[plan][interval], quantity: 1 }],
     customer: { email: user.email },                 // prefill from Supabase auth
     customData: { org_id: orgId },                   // ← flows to txn → subscription → webhooks
   })
   ```
2. **`customData.org_id` is the linchpin**: Paddle copies transaction custom data onto the
   subscription and every renewal transaction, and it appears in webhook payloads — this is how
   the webhook knows which org to provision. (`developer.paddle.com/build/transactions/custom-data`)
3. **Do NOT provision on the client success callback.** Show a "processing" state; the webhook is
   the source of truth (`developer.paddle.com/build/subscriptions/provision-access-webhooks`).
4. Recurring items on one checkout must share a billing interval (can't mix monthly + annual).

---

## 5. Webhook handler `POST /api/paddle/webhook` (server, source of truth)

**Copy `src/app/api/github/webhook/route.ts` structure verbatim**, adjusting the signature scheme:

- `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'` (`:11-12`).
- **Raw body**: `const raw = await req.text()` before any JSON parse (`:29`).
- **Verify**: `Paddle-Signature: ts=<unix>;h1=<hex>`; signed payload = `` `${ts}:${raw}` ``;
  HMAC-SHA256 with `PADDLE_WEBHOOK_SECRET`; constant-time compare (reuse the length-guarded
  `timingSafeEqual` pattern at `github/webhook/route.ts:15-21`); reject if `ts` older than ~5s
  tolerance. **Prefer the SDK helper** `paddle.webhooks.unmarshal(raw, secret, sig)` which does
  all of this and returns a typed event.
- **Idempotency**: INSERT `event_id` into `paddle_webhook_events`; on unique-violation return
  `{ok:true, duplicate:true}` early (mirror `github/webhook/route.ts:48-53`).
- **Ordering**: events are at-least-once and **can arrive out of order** — reason from
  `data.status` + `occurred_at`, and always UPSERT the latest known state (don't blindly apply
  deltas). Respond **HTTP 200 within 5s** (our handler is just DB upserts — fine).
- Uses `requireAdminClient()` (service_role), like the GitHub handler (`:45`).

**Event → action map** (resolve org via `data.custom_data.org_id`, fall back to
`paddle_subscription_id`/`paddle_customer_id` lookup):

| event | action |
|---|---|
| `subscription.created` / `subscription.activated` | set `plan` (from price_id→plan map), `subscription_status`, `paddle_customer_id`, `paddle_subscription_id`, `current_period_*` from `data.current_billing_period`; reset usage counts to 0 |
| `subscription.updated` | update `plan`/`status`/`scheduled_change`; **on renewal (new period)** reset `current_period_query_count`/`token_count` to 0 and roll period dates |
| `subscription.past_due` | `subscription_status='past_due'` — **keep access**, surface a "결제 실패" banner |
| `subscription.paused` / `subscription.canceled` | on effective date: `subscription_status`, downgrade `plan='free'`; restrict to free caps |
| `transaction.completed` | (optional) insert `billing_transactions` row for the billing-page history |

**price_id → plan map**: we own the catalog, so a static `{ [priceId]: {plan, interval} }` from
config (built from the `PADDLE_PRICE_*` env) — no API round-trip needed.

---

## 6. Quota enforcement — the "한도 시스템" (two kinds)

Build `plans/limits.ts` (the table above) + `plans/usage.ts` helpers into
`src/lib/plans/` as the TS SSOT. **Not `server-only`** (touched by the Trigger host).

### (a) Resource-count caps — block at creation (`enforceLimit`)
`count(*)` of the resource for the org vs the plan cap; return a friendly "upgrade" error if at
the cap. Exact insertion points (from the codebase map):

| resource | insert gate at | count source |
|---|---|---|
| data source | `src/app/api/data-sources/route.ts:34` (after `orgId`, before register `:54/:60`) | `data_sources` |
| alert | `src/lib/alerts/actions.ts:75` (before insert `:86`) | `alerts` |
| dashboard | `src/lib/dashboards/actions.ts:110` (before insert `:115`) | `dashboards` |
| widget | `src/lib/dashboards/actions.ts:66` (before insert `:78`) | scoped to `dashboard_id` |
| team member | `src/lib/org/actions.ts:149` (before `invite_member` RPC) | members + pending invites |

### (b) Metered budget — check before the LLM run, increment after (`checkAllLimits`)
This is the "구독 후 metered" core **and it closes the live cost-abuse hole** (today
`/api/agent/analyze` runs unlimited).

- **Pre-run gate** (BFF holds `requireAdminClient` already, so read plan+usage directly):
  - SQL + Firestore agent: `src/app/api/agent/analyze/route.ts:55` (after `orgId`, before insert
    `:61` / trigger `:79`). One gate covers both engines (the route branches to
    `analyze-firestore` at `:57`).
  - Code agent: `src/app/api/code/analyze/route.ts:52` (after `repo.org_id`).
  - If over `queries_per_month` OR `tokens_per_month` → 402/429 with a "limit reached, upgrade"
    payload; do not trigger the run.
- **Query increment** (known at BFF): `increment_org_usage(orgId, 1, 0)` at the run insert
  (`agent/analyze/route.ts:61`).
- **Token increment** (only known AFTER the run, on the Trigger host): the convergence seam is
  **`persistRun` (`src/lib/agent/run-record.ts:18`)** — called by all three transports
  (`trigger/analyze.ts:77`, `trigger/analyze-firestore.ts:80`, local SSE
  `runs/[id]/stream/route.ts:78`). `AnalysisResult` carries `tokensIn`/`tokensOut`
  (`run-analysis.ts:18-24`). **`persistRun` lacks `orgId`** → thread `orgId` in (all callers have
  it) or `SELECT org_id FROM agent_runs`, then
  `increment_org_usage(orgId, 0, tokensIn+tokensOut)` via the service-role client it already holds.
  The **code agent is a separate path** (`persistCodeRun`, `trigger/analyze-code.ts:85`) — add its
  own increment.

### Period reset
- **Paid**: reset counts on the `subscription.updated` renewal (new `current_billing_period` from
  Paddle).
- **Free**: no Paddle events → lazy reset in the gate — if `now >= current_period_ends_at`, zero
  the counts and roll the window +1 month (same idea as old `checkAndResetExpiredPeriod`).
- **New orgs default to `free`** via the column default; also ensure `create_organization` leaves
  `plan='free'`.

---

## 7. Self-serve plan management (minimal code)

Use the **Paddle Customer Portal** instead of building cancel/upgrade UI:
`POST /customers/{paddle_customer_id}/portal-sessions` → returns short-lived, auto-sign-in URLs:
`general.overview`, and per-subscription `cancel_subscription` / `update_subscription_payment_method`
deep links. **Mint fresh per click, never cache.** (`developer.paddle.com/build/customers/integrate-customer-portal`)

- "구독 관리 / 취소 / 카드 변경" → open the portal URL.
- "업그레이드" → new `Paddle.Checkout.open` for the higher tier (or `PATCH /subscriptions/{id}`
  with `proration_billing_mode: 'prorated_immediately'`). For v1, portal + checkout is enough.

---

## 8. UI to replace (currently 100% mock)

- `src/app/app/settings/billing/page.tsx` — kill the hardcoded plan banner + fake `USAGE`/`TX`
  arrays (`:3-17,42-52,105`); render real `plan`, cycle usage (new columns), limits (TS table),
  a "관리" → portal-session link, and an upgrade checkout button.
- `src/components/dashboard/Sidebar.tsx:347-357` — replace the hardcoded "STANDARD 3,200/5,000"
  meter with live plan + `current_period_query_count`.
- **Add `src/app/app/settings/layout.tsx` with a tab strip** (billing / members / integrations) —
  fixes billing discoverability AND the orphaned Members page in one move.

---

## 9. Security invariants (do not regress)

- **Webhook**: raw-body HMAC verify + 5s tolerance + `event_id` idempotency + service_role-only
  writes. Provision ONLY from webhooks, never from the client success callback.
- **org binding**: `custom_data.org_id` is set by our authed checkout only; still validate the org
  exists and, on `subscription.updated`, that the incoming `paddle_subscription_id` matches the org
  it's already bound to (don't let a replayed/rogue event repoint a subscription to another org).
- **Quota gate is also the cost-abuse fix** — unbounded `ANTHROPIC_API_KEY` spend is closed by the
  pre-run metered gate (§6b). Ship that even before payments.
- **Keys**: `PADDLE_API_KEY` backend-only (never in Paddle.js); client token is public by design.

---

## 10. Phased rollout (ship value early)

1. **Foundation** — M1–M4 migrations + `plans/limits.ts` + `getPaddleConfig` + env. No UX change.
2. **🔴 Cost gate (ship FIRST, decoupled from payments)** — metered pre-run gate + query/token
   increment on the analyze endpoints (§6b). Closes the live cost hole immediately; everyone is
   `free`-capped until they subscribe.
3. **Checkout + webhook** — Paddle dashboard catalog, checkout page, `/api/paddle/webhook`,
   provisioning. Orgs can now subscribe and get their plan.
4. **Resource caps** — `enforceLimit` at all create points (§6a).
5. **UI** — real billing page + portal link + live sidebar meter + settings tab nav.
6. **Polish (optional)** — `billing_transactions` history, trials (Paddle `trial_period` / cardless
   trials), `past_due` dunning email, later overage via one-time charges.

---

## 11. Testing

- **Sandbox end-to-end**: sandbox client token + sandbox price IDs + `sandbox-api.paddle.com`.
- **Signature unit test** for the webhook verifier (like the GitHub one), including a
  tampered-body reject and a stale-timestamp reject.
- **Provisioning integration**: replay captured `subscription.created/updated/canceled` payloads,
  assert `organizations` billing columns; assert idempotency (same `event_id` twice = one effect).
- **Quota**: pure unit tests on `limits.ts`/`checkAllLimits`; integration test that
  `increment_org_usage` is atomic and the gate blocks at the cap and resets on period roll.
- Local webhook: a tunnel (e.g. cloudflared/ngrok) → Paddle notification destination.

---

## 12. Product decisions (CONFIRMED 2026-07-03)

1. **Metered model** — ✅ **flat tiers + app-enforced quota** (Paddle charges the flat fee; the app
   meters + blocks). True overage billing deferred.
2. **What to meter** — ✅ **queries AND tokens** — both hard-capped per cycle; query count at the
   BFF, token count via the `persistRun` seam.
3. **Pricing numbers** — ✅ reuse the SSOT table in §1 (free / $29 / $99 / $299 + those limits).
4. **Trials** — ✅ **no trial**; the free tier is the funnel. Paid access starts at checkout.
5. **KR methods** — enable KakaoPay/NaverPay recurring in the Paddle dashboard (dashboard toggle,
   no code impact).

---

### Unverified-at-build flags (from the Paddle research, re-check during impl)
- Webhook retry count/backoff schedule not documented (design for "retries happen, dedupe on
  `event_id`").
- `initializePaddle` `environment` option vs token-prefix — pass `environment` explicitly with the
  npm package.
- Grant on `subscription.created`; confirm payment on `transaction.completed`/`subscription.activated`.
