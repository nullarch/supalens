# Public Demo Page (`/demo`) — no-signup live demo

> **2026-09-17 — v2.** The page, dataset and cache rules below the API contract were rebuilt:
> editorial console with live progress, rolling US-dollar "Northwind Supply" dataset with planted
> stories, cache bound to the current data week, and a fix for the broken Trigger.dev
> `DEMO_DATABASE_URL`.
> The API contract and gates in this document still apply; the Reel, terminal showcase and Korean
> KRW dataset described below are retired.

**Status: BUILT (2026-07-18).** All three phases shipped same-day: migration `20260718100000`
(applied to remote + `db:types`), `src/lib/demo/{public-demo,service}.ts` + unit tests,
`/api/demo/ask`, `src/app/[locale]/demo/` (page + DemoClient + css), `demo` message namespace
(en/ko/ja), middleware `INTL_PATH` + sitemap + landing-nav "Live demo" link, prune retention
(demo_requests 7d RETENTION rule + env-gated 30d demo-org agent_runs). E2E-verified: live run (Trigger dev worker) → succeeded with viz → identical question
(whitespace-fuzzed) served `mode:'cached'` → ledger held exactly 1 hashed-IP row; Playwright
light/dark/mobile/ko screenshots passed. The backing org is one
`organizations` row with no members (`PUBLIC_DEMO_ORG_ID`). Design notes below are as-built.

**Design revision (same day):** after a 3-variant exploration (`/dev/demo/v1..v3`, kept for
reference), the live page was rebuilt in the **V1 "Terminal / SQL-forward"** direction with a
**results-first** structure (owner decision: lead with real outputs, keep interactivity as
verification): hero → psql-style schema terminal → showcase of two pre-rendered analyses
(descriptive chart turn + diagnostic "why revenue jumped" turn, each with an agent tool trace +
the executed SQL highlighted) → alert root-cause Slack card ("even unasked — with the why") →
Auto-KPI payoff grid → "verify it yourself" (clickable chips → cached answers + live console
composer) → CTA. The showcase turns are static fixtures grounded in the demo catalog samples;
the query is the hook and the consulting is the payoff.

**Reel (video-form showcase, same day):** the two static showcase turns became an auto-playing
looping "screen recording" (`Reel.tsx`): typed question → staggered tool-trace check-ins → SQL
streaming line-by-line into a bottom-pinned terminal (clay glow while running) → widgets animate
into a fixed-height result pane (no layout jumps) → typed answer → 2 scenes with clickable tabs
+ progress bars. CSS/JS only (no video asset) so it stays theme-aware and localized;
`prefers-reduced-motion` renders the scene fully static; an `.srOnly` block keeps the Q&A text
crawler-visible. Fill-mode bignumber needs ≥184px cell height (widget QA 2026-07-12 caveat).

**Wide remake (same day):** page container widened to 1320px; the reel became a FULL-BLEED
16:9 cinematic player (`min(1440px, 100vw-40px)`, `aspect-ratio: 16/9`, `container-type:
inline-size` so inner type scales in cqw like a rendered video) — typed question as the top
caption strip, terminal | result panes inside, chapter pills + `supalens · live demo` brand +
full-width clay scrubber as the bottom bar; `.page` gets `overflow-x: hidden` so the 100vw
bleed can never grow a page h-scroll. Alert section is text|Slack-card two-column; payoff is a
4-column dashboard grid (spans 1+1+2 / 2+2, adds `order_count`). Phones drop the ratio and
stack the panes (terminal 300px).

Purpose: the Show HN / landing-funnel surface —
"try supalens on a live e-commerce database, no signup." Rationale (
2026-07-18 three-agent review): the variable that works on HN is *framing* (something you can
play with without signing up), not license — camelAI got 156pt closed with exactly this shape
after 3pt/2pt product posts. This page is that framing, built almost entirely from existing
parts.

**Scope guard:** this is the launch-event enabler allowed by the 90-day plan (런치 = 이벤트,
바이럴 루프/커넥터 외 신기능 금지의 예외로 승인된 범위). Budget ≈ 2–3 days. Anything beyond
the v1 section below is explicitly out.

---

## 1. What the visitor gets

Public marketing page at `/demo` (`/ko/demo`, `/ja/demo`), no auth:

1. **Hero strip** — one line ("Ask a live production-style database anything — no signup"),
   a "live database" badge, and a schema peek (the demo e-commerce tables as chips:
   `orders`, `customers`, `products`, `order_items`, …) so it reads as real, not canned.
2. **Suggested questions** — 6–8 localized chips ("What was revenue last week?", "Which
   product is trending?", "이번 달 신규 고객은?" …). Chips serve **cached** results
   instantly (zero LLM — see §4). This is what absorbs an HN spike.
3. **Free-text ask box** — the credibility maker. ≤300 chars, rate-limited, runs the real
   agent live and streams the answer (text + charts) exactly like `/app/ask`.
4. **Result panel** — reuses `AgentView`/`WidgetRenderer` verbatim (same components, same
   spec). Session history is client-local only (state/localStorage), no server history UI.
5. **Payoff section** — the "핵심 KPI" dashboard grid rendered statically from the canned
   demo KPI catalog (`src/lib/kpi/demo-catalog.ts` samples through `WidgetRenderer`,
   zero queries). Mirrors the landing live-motion taste rule (no dead-static hero).
6. **Conversion CTA** — sticky "Connect your own Supabase/Postgres — free" →
   `/login?next=/app/ask`; secondary link to the MCP docs ("or use it from Claude").

Degrade contract (repo convention): with `DEMO_DATABASE_URL` or `PUBLIC_DEMO_ORG_ID` unset,
the page still renders — chips fall back to fixture answers (`__fixtures__`-style persisted
results), the free-text box is disabled with a "demo warming up" note. Never a crash, never
a signup wall.

## 2. Architecture — one new route, zero new runtimes

The public demo is **the existing demo-source path minus auth**, behind a dedicated org:

- **Demo org**: one platform-owned `organizations` row (no members → invisible to every
  user via RLS; service_role only). Its id ships as env `PUBLIC_DEMO_ORG_ID` — no
  migration, no special org flag. `ensureDemoSource(demoOrgId)` (existing, idempotent)
  provisions the `is_demo` data source + canned KPI catalog.
- **Run path**: `POST /api/demo/ask` → `createAgentRun` (existing) with `userId: null`,
  taskId `analyze` → Trigger.dev → result streams to the browser via the run-scoped
  public token (`auth.createPublicToken`, single-run read scope, 2h — same as
  `/api/agent/analyze`). `AgentStream` works unchanged; anonymous is fine because the
  token, not the session, is the credential.
- **Tenant binding**: the client sends ONLY `{question}`. Org + data source are resolved
  server-side from env — the one-run-one-tenant invariant holds trivially; there is no
  client-chosen `dataSourceId` on this route.
- **Persistence**: runs land in `agent_runs` under the demo org as usual (`user_id` null).
  `persistRun` already skips the monthly usage increment for `is_demo` sources; the
  **daily abuse cap** (`MAX_RUNS_PER_ORG_PER_DAY`, counted per org inside
  `checkUsageQuota`) still counts them — that existing cap IS the global daily budget.

### API contract — `POST /api/demo/ask`

```
req  { question: string }            // ≤300 chars after trim
res  { mode: 'cached',  result }                                   // instant, zero LLM
   | { mode: 'trigger', runId, triggerRunId, publicToken }         // live streamed run
   | 429 { error: 'rate_limited' | 'busy' | 'daily_budget' }       // see §3
   | 400 / 503 (unconfigured)
```

Order of operations (fail closed at every gate):

1. Validate question (trim, length, non-empty).
2. **Cache lookup** (§4) — hit → return immediately, no limits consumed.
3. Per-visitor limit (IP-hash + cookie id, §3).
4. Global gates: `checkUsageQuota(demoOrgId)` — **the new-LLM-entry-point invariant** —
   plus `DEMO_MAX_RUNS_PER_DAY` (own env, default 150 < the 200 org day-cap so the demo
   can never exhaust the org cap alone) and an in-flight cap (≤4 queued/running in the
   demo org) → `busy` tells the UI to push chips ("try a suggested question meanwhile").
5. `createAgentRun` — with a **concurrency bucket override**: `concurrencyKey:
   'demo-' + (hash(runId) % 4)`. Today `createAgentRun` hardcodes
   `concurrencyKey: dataSourceId`, which would serialize every public run behind one
   queue key on launch day. Add optional `concurrencyKey` to `CreateRunInput`
   (BFF-side only — no Trigger host redeploy; the task itself is untouched).
6. Insert a `demo_requests` row (§3), mint the public token, respond.

Local dev (`no_worker`): the existing SSE route requires auth; for the demo route just
surface "live runs need the worker" in dev, or run signed-in — not worth a bypass.

## 3. Abuse & cost controls (anonymous LLM endpoint — the whole risk)

Threat model: the agent is structurally read-only on a throwaway seeded DB with no tenant
data, so prompt injection ≈ harmless; the only real assets at risk are **tokens/money** and
**queue starvation**. Controls, cheapest first:

- **Chips are free**: canonical questions always cache-hit after first run (§4) — the
  high-traffic path costs zero LLM.
- **Per-visitor**: `demo_requests` table (migration, service_role only, RLS deny-all):
  `id, ip_hash, cookie_id, question, run_id, created_at`. Limit = max(count by ip_hash,
  count by cookie_id) over 24h ≥ `DEMO_RUNS_PER_VISITOR_PER_DAY` (default 5) → 429.
  ip_hash = SHA-256(ip + server salt) — no raw IPs stored. Cookie: httpOnly random id,
  set on first ask.
- **Global/day**: `DEMO_MAX_RUNS_PER_DAY` (own counter on `demo_requests`) +
  `checkUsageQuota` day-cap as the backstop.
- **Concurrency**: in-flight ≤4 → `busy` (chips still work). Prevents queue pileup and
  caps worst-case parallel token burn.
- **Per-run**: existing `maxTurns` + token-budget abort in `run-analysis.ts` bound the
  cost of any single hostile question.
- **Escalation hatch (build-flagged, not v1)**: Cloudflare Turnstile on the free-text
  box behind `TURNSTILE_SECRET_KEY` — wire the env check only; add the widget if launch
  telemetry shows abuse. Don't pay the friction up front.
- **Retention**: `demo_requests` 7d, demo-org `agent_runs` 30d — two typed pins added to
  the existing `prune.ts` RETENTION table (chips re-warm on next ask after prune).

## 4. Answer cache — `agent_runs` IS the cache

No new cache table. Lookup: most recent `succeeded` run in the demo org with the same
normalized question (trim + collapse whitespace; chips match exactly because the UI sends
canonical strings) within `DEMO_CACHE_TTL` (7d) → serve its persisted `result`
(answer + visualizations render through the same `AgentView` path as `/share`).
Locale note: chips are localized strings → each locale warms its own cache row; pre-warm
en + ko chips once post-deploy (a one-off script or just clicking through `/demo` and
`/ko/demo`).

## 5. Reuse map (why this is 2–3 days, not 2 weeks)

| Piece | Source | Change |
|---|---|---|
| Demo source + seed + canned KPIs | `demo.ts`, `demo/seed.sql`, `kpi/demo-catalog.ts` | none |
| Run creation + dedupe | `agent/create-run.ts` | +optional `concurrencyKey` |
| Quota/abuse gate | `plans/usage.ts::checkUsageQuota` | none (called as-is) |
| Agent + streaming | `trigger/analyze.ts`, `AgentStream`, public token | none |
| Rendering | `AgentView`, `WidgetRenderer`, viz spec | none |
| Share loop (v1.5) | `share-actions.ts`, `/share/[token]` | demo-org variant of `shareRun` (service-role, demo-org-runs only) — "Powered by supalens" badge already planned as viral loop |
| i18n | `messages/*` | new `demo` namespace (en primary, ko, ja machine) |
| Middleware | `src/middleware.ts` | add `demo` to `INTL_PATH` alternation |
| SEO | `sitemap.ts`, OG image | add `/demo` + locale alternates, `opengraph-image` |

New files: `src/app/[locale]/demo/{page.tsx,DemoClient.tsx}`, `src/app/api/demo/ask/route.ts`,
`src/lib/demo/{limits.ts,cache.ts}` (pure helpers, unit-testable), migration
`demo_requests`, fixtures for the unconfigured fallback.

## 6. Non-goals (v1)

- No thread continuity / follow-up questions for anonymous visitors (each ask is
  single-turn; `priorRunIds` plumbing exists if v1.5 wants ≤3-turn follow-ups).
- No anonymous dashboard building, KPI extraction, alerts, or MCP — the payoff section
  *shows* those outcomes statically instead.
- No `/dev`-style gallery exposure, no per-visitor server-side history.
- No Turnstile at launch (flag only), no Redis/edge rate limiting (Postgres window is
  enough at these caps).

## 7. Build plan

- **Day 1 — plumbing**: `demo_requests` migration + `db:types`; `PUBLIC_DEMO_ORG_ID`
  bootstrap (create org row once via SQL); `/api/demo/ask` (validate → cache → limits →
  quota → createAgentRun+bucket → token); `lib/demo/{limits,cache}.ts` + unit tests.
- **Day 2 — surface**: `[locale]/demo` page + `DemoClient` (chips / ask box / AgentView /
  payoff grid / CTA); `demo` message namespace (en, ko; ja machine draft); middleware
  `INTL_PATH`; unconfigured-fallback fixtures.
- **Day 3 — launch polish**: sitemap + OG image + landing nav/hero "Live demo" links;
  prune pins; pre-warm chips; Playwright screenshots light/dark/mobile (per the
  landing-section verify rule); rate-limit smoke test (hammer the route).

**Deploy checklist**: apply migration → `db:types`; set `PUBLIC_DEMO_ORG_ID` (+ optional
`DEMO_MAX_RUNS_PER_DAY`, `DEMO_RUNS_PER_VISITOR_PER_DAY`) on **Vercel only** — the Trigger
host needs nothing new and does NOT need a redeploy (`analyze` task unchanged);
`DEMO_DATABASE_URL` already set on both. Show HN submission URL = `https://supalens.ai/demo`.

## 8. Open questions (decide before Day 1)

1. Free-text cap 5/day/visitor — right number? (Lower = safer, higher = better HN comments
   section experience. 5 feels right; HN commenters testing edge cases burn 2–3.)
2. Should cached answers be labeled? Recommendation: yes, a subtle "answered live · cached
   Xh ago" chip — HN will notice instant responses and call fake; the label converts
   suspicion into a feature.
3. Demo DB hosting headroom: current `DEMO_DATABASE_URL` throwaway Postgres must survive
   ~4 concurrent agent query bursts — verify tier before launch day.
