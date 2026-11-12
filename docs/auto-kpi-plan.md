# Auto-KPI — repo-driven KPI extraction + one-shot setup

**Status: BUILT (v1, 2026-07-06).** All four phases shipped: foundation (migration
`20260706090000` + `src/lib/kpi/*` + `propose_kpi`), BFF + apply, review UI + sources chip +
onboarding step, MCP tools + webhook staleness + demo canned catalog. Per-row alert toggles in
the review UI were simplified to one master 알림 포함 toggle (the apply API takes a single
`withAlerts`); the demo catalog seeds proposals (chip → review page) rather than a pre-applied
dashboard — both noted for v1.5. See the "Auto-KPI" section in CLAUDE.md for the operating map.
Pending ops: apply the migration + `db:types`, `npx trigger.dev deploy`.

## One-line

Connect a repo (+DB) → the agent reads the code and schema → proposes a **validated, runnable
KPI catalog** (each KPI = title + SQL + chart spec + optional alert + code/table evidence) →
the user reviews a checklist → **one click** creates the KPI dashboard + alerts.

## Why this feature

- It is the "code is context" thesis productized one level up: SUPALENS.md makes queries
  *accurate*; Auto-KPI makes the product *immediately useful* — the connected org gets a live
  dashboard + monitors without writing a single question.
- It attacks the known weakest onboarding point (demo → own-DB connect lands on an empty
  screen). After Auto-KPI, "connect" has an obvious payoff: "우리 서비스 핵심 지표 18개가
  자동으로 제안됐어요".
- The conceptual pathway already exists but only manually: MCP `create_dashboard` is described
  as "how you turn KPIs you found in a repo into a shared, live dashboard" and widgets carry a
  `source` provenance field (`src/lib/mcp/tools.ts:396,406`). Auto-KPI is that same loop,
  in-product, batched, and one-shot.

## What "accurate" means (the user-facing promise)

Every proposed KPI is **proven-runnable by construction**: the model must first execute the
SQL through the guarded engine (`execute_sql` → `executeReadOnly`: SELECT-only, READ ONLY tx,
timeout, row cap, audit) and only then register it via `propose_kpi({queryId, …})`. A KPI
whose SQL fails or whose chart references nonexistent columns is rejected back to the model
with a self-repair error (the exact `propose_visualization` pattern in
`src/lib/agent/tools.ts:84-123`). Nothing enters the catalog that didn't actually run.

Every KPI also requires **evidence** (`[{kind:'file'|'table'|'event', ref, note}]`) — e.g.
"근거: `src/webhooks/paddle.ts`, `orders` 테이블" — so the user can trust *why* this KPI
applies to their service, not just that the SQL runs.

## Two tiers (same as SUPALENS.md context)

- **tier-1 (DB only, no repo)** — the extraction agent runs with schema tools only
  (`get_schema` + `execute_sql`): instantiates the built-in template catalog against the real
  schema. LLM-based (unlike context's deterministic tier-1) because template→schema mapping is
  a judgment task; still one bounded agent run.
- **tier-2 (repo attached)** — the code×DB agent (`runCodeAnalysis` with `dataSourceId`
  bound) additionally reads payment webhooks, auth flows, tracking calls (`track(…)`,
  posthog/GA), queue/job code → produces **service-specific** KPIs (the differentiator):
  funnels from real tracked events, "core action" metrics named after what the product
  actually does, feature-adoption for recently shipped code.

If a fresh SUPALENS.md context exists it is injected as usual (the extraction rides the same
system-prompt seam), making extraction cheaper and better — but it is not a prerequisite.

## The KPI template catalog (지표 리스트)

Ships as `src/lib/kpi/templates.ts` — the agent's menu (prompt-injected) and tier-1
vocabulary. Each template: `{key, category, title, description, requiredShapes (table/column
hints), sqlSkeleton, defaultChart, defaultAlert?}`. The agent (a) instantiates templates whose
required shapes exist in the schema, mapping real table/column names, and (b) proposes
`custom`/`funnel` KPIs from code evidence beyond the templates.

| # | key | Category | KPI | Needs (shape hints) | Chart | Default alert |
|---|-----|----------|-----|---------------------|-------|---------------|
| 1 | `new_signups` | growth | 일 신규 가입 | users-like(created_at) | line | anomaly |
| 2 | `dau` / `wau` / `mau` | growth | 활성 사용자 | events/sessions/last_seen | line | anomaly |
| 3 | `activation_rate` | growth | 가입→첫 핵심 액션 도달률 (D7) | users × core-action | bignumber | — |
| 4 | `growth_rate_wow` | growth | 주간 가입 성장률 | derived from #1 | bignumber | threshold lt 0 |
| 5 | `daily_revenue` | revenue | 일 매출 / GMV | orders/payments(amount,status,ts) | bar | anomaly |
| 6 | `mrr` | revenue | 활성 구독 MRR | subscriptions(status,price) | bignumber+line | — |
| 7 | `arpu` | revenue | 결제유저당 평균 매출 | derived | bignumber | — |
| 8 | `aov` | revenue | 평균 주문 금액 | orders | bignumber | — |
| 9 | `paying_conversion` | revenue | 가입→첫 결제 전환율 | users × payments | bignumber | — |
| 10 | `refund_rate` | revenue | 환불율 | orders(status=refunded) | line | threshold gt |
| 11 | `churn_rate` | revenue | 월 구독 해지율 | subscriptions transitions | line | threshold gt |
| 12 | `revenue_by_plan` | revenue | 플랜별 매출 구성 | orders/subs × plan | donut | — |
| 13 | `core_action_count` | engagement | 핵심 액션 수 (**code-derived name**: 분석 실행/주문/게시…) | domain table | line | anomaly |
| 14 | `retention_d7` | engagement | D1/D7/D30 리텐션 | events/users cohort | line | — |
| 15 | `feature_adoption` | engagement | 신규 기능 사용률 (tier-2: recent git history) | feature table/event | bar | — |
| 16 | `actions_per_user` | engagement | 유저당 액션 수 | events | bignumber | — |
| 17 | `payment_failure_rate` | ops | 결제 실패율 | payments(status=failed) | line | threshold gt |
| 18 | `webhook_failures` | ops | 웹훅 처리 실패 | webhook_events(error) | bignumber | threshold gt 0 |
| 19 | `error_events` | ops | 에러 이벤트 수 | error/log table | line | anomaly |
| 20 | `job_backlog` | ops | 큐/잡 적체 | jobs(status=pending) | bignumber | threshold gt |
| 21 | `signup_failures` | ops | 가입 실패/중단 | auth events | line | threshold gt |
| 22 | `funnel_conversion` | funnel | 방문→가입→활성→결제 전환 (tier-2: from `track()` calls) | events | bar/table | — |
| 23+ | `custom_*` | custom | 서비스 고유 지표 (tier-2: from code) | — | agent's choice | agent's choice |

Target output per run: **12–25 KPIs**, importance-scored 1–5, quality over quantity (the
prompt says: skip templates whose shapes don't exist rather than forcing them).

## Architecture — composition of existing seams (nothing forked)

```
POST /api/data-sources/[id]/kpis/extract        (BFF: auth → member+ → checkUsageQuota → 402)
  └─ tasks.trigger('extract-kpis', payload, {concurrencyKey: repoId ?? dataSourceId})
       trigger/extract-kpis.ts                   (mirrors trigger/generate-context.ts verbatim)
         ├─ repo attached → getInstallationToken (host-only, never in payload/subprocess)
         │   └─ runCodeAnalysis({question: KPI_EXTRACT_PROMPT, dataSourceId, kpiSink})
         ├─ no repo → runAnalysis({prompt: KPI_EXTRACT_PROMPT(tier1), kpiSink})
         │   (either way: agent loops get_schema → write SQL → execute_sql (returns queryId,
         │    stashes result in the in-process Map) → propose_kpi({queryId, …}) per KPI)
         ├─ kpiSink validates + collects → upsert kpi_catalog rows (service_role)
         └─ incrementUsage(orgId, 1, tokens)     (post-run, same as runContextGeneration)

GET  /api/data-sources/[id]/kpis                 → catalog rows (RLS member read)
POST /api/data-sources/[id]/kpis/apply           {kpiIds[], dashboardId?|'new', withAlerts}
  └─ per KPI: revalidate via the shared buildWidgetSpec path (assertReadOnly →
     executeReadOnly dry-run → column check → VisualizationSpec.safeParse — the exact MCP
     create_dashboard two-phase: validate ALL before writing ANY)
     → idempotent dashboard "핵심 KPI" (slug, like MCP create_dashboard)
     → saved_queries (+ `source` provenance jsonb = evidence) + dashboard_widgets
     → alert_config && withAlerts → createAlert() (existing validation + caps)
     → stamp kpi_catalog.status='accepted', applied={dashboardId,widgetId,savedQueryId,alertId}
```

Everything downstream of apply is the **existing** runtime: dashboards live-refresh re-runs
`query.sql` through `executeReadOnly` (`runWidgetData`), the alert cron evaluates
`metric_sql` on schedule, root-cause explain and Slack/email notify all come for free.

### New in-process tool: `propose_kpi`

Registered in `src/lib/agent/tools.ts` next to `propose_visualization`, gated on a new
optional `KpiSink` (mirror of `VizSink`) so existing runs are untouched. Input:

```ts
{ queryId: string,            // must reference a prior successful execute_sql
  key: string,                // stable slug, unique per source
  title: string, category: 'growth'|'revenue'|'engagement'|'ops'|'funnel'|'custom',
  description: string, importance: 1|2|3|4|5,
  chart: ChartSpec,           // validated against the stashed result's columns
  alert?: { type:'threshold'|'anomaly', operator?, threshold?, sensitivity? },
  evidence: Array<{kind:'file'|'table'|'event', ref: string, note?: string}> }
```

Validation inside the tool (all self-repair `isError` returns, zero DB/vault access of its
own — reads only the in-process result Map, preserving the lockdown invariant):
1. `queryId` exists in the Map (guarantees the SQL executed through the guarded engine).
2. `alert` present → result must be scalar-shaped (1×1) so the alert runner can evaluate it.
3. `referencedColumns(chart)` ⊆ result columns (else return the valid column list).
4. Build the full `VisualizationSpec` (`{v:1, query:{sql}, sample:{columns, rows≤50}, chart}`)
   and `safeParse`; the `sample` is persisted so the review UI renders instant previews with
   `WidgetRenderer` — no live query on page load.
5. `evidence` non-empty; `key` not already proposed this run.

The code agent path needs one additive change: `RunCodeAnalysisArgs` gains `kpiSink?` and,
when set, `propose_kpi` joins `ALLOWED_TOOLS` + the `canUseTool` gate (the DB tools are
already the same in-process server, so the Map/queryId plumbing exists).

### Data model — one migration (`kpi_catalog`)

```sql
create table kpi_catalog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  data_source_id uuid not null references data_sources(id) on delete cascade,
  run_id uuid,                          -- the extraction run (code_analysis_runs / agent_runs)
  key text not null,
  title text not null,
  category text not null check (category in ('growth','revenue','engagement','ops','funnel','custom')),
  description text,
  importance smallint not null default 3,
  metric_sql text not null,
  viz_spec jsonb not null,              -- full VisualizationSpec (incl. sample for preview)
  alert_config jsonb,
  evidence jsonb not null default '[]',
  status text not null default 'proposed' check (status in ('proposed','accepted','dismissed','stale')),
  applied jsonb,                        -- {dashboardId, widgetId, savedQueryId, alertId}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (data_source_id, key)
);
```

RLS: `kpi_sel` member read; inserts are service_role only (the agent host writes); member+
may UPDATE, with a BEFORE UPDATE guard trigger restricting non-service roles to
`status`/`applied` (house pattern: `app.guard_org_billing_write`). Re-extraction upserts by
`(data_source_id, key)` and marks vanished keys `stale` rather than deleting (an applied KPI
keeps its dashboard/alert regardless — apply-time revalidation is the safety net, and the
alert path re-runs `assertReadOnly` at creation anyway).

### Module layout

```
src/lib/kpi/
  templates.ts        # the catalog above (typed, prompt-renderable)
  prompt.ts           # KPI_EXTRACT_PROMPT (tier-1/tier-2 variants; injects templates + rules)
  service.ts          # listKpis / upsertProposals / setStatus (admin + user-JWT halves)
  apply.ts            # the one-shot apply (shares the buildWidgetSpec validation path)
trigger/extract-kpis.ts   # task id 'extract-kpis' (payload mirrors GenerateContextPayload;
                          # repo fields optional → tier-1 when absent)
src/app/api/data-sources/[id]/kpis/{route.ts, extract/route.ts, apply/route.ts}
src/app/app/sources/[id]/kpis/page.tsx + KpiReviewClient.tsx
```

## UX — user exposure journey (6 touchpoints, funnel order)

Principle: **show the artifact before the process** (users meet the resulting dashboard
first, not the extraction machinery), and **no zero-click writes** (trust comes from the
review pass; the sole exception is the canned demo catalog).

**0. Demo — before anything is connected (acquisition).** The auto-provisioned demo source
ships with a **canned catalog** (`src/lib/kpi/demo-catalog.ts`, precomputed for the demo
schema — zero LLM cost) pre-applied as a pinned "핵심 KPI (데모)" dashboard. First-visit
users see the *output* of Auto-KPI within seconds; copy: "여러분 DB를 연결하면 이걸 자동으로
만들어 드려요".

**1. Connect moment (activation).** Right after a DB source is registered (direct form
success / OAuth callback → sources redirect), the success state carries one CTA: **"핵심
KPI 자동 추출"**. Attaching a repo upgrades the pitch ("코드 기반 KPI — 퍼널·고유 지표까지").
A new `OnboardingChecklist` step ("KPI 자동 추출") keeps it visible on `/app/ask` for users
who skip the moment. Extraction is manual-trigger in v1 (cost control + expectation setting);
the click hits the quota gate, then the chip flips to 생성 중.

**2. Status — `/app/sources` chip.** Each SQL source gains a **◆ KPI 카탈로그** chip beside
the 컨텍스트 chip, same 5s-polling pattern and state machine: `추출` (none) → `생성 중…` →
`제안 N개` (click → review page) → `새 제안 N개` / `오래됨` (staleness). No live agent-stream
UI in v1 — polling parity with context generation keeps it one pattern.

**3. Review page `/app/sources/[id]/kpis` (the decision surface).** A full page (15–25 rows
with previews need room), grouped by category:

```
제안된 KPI 18개 · 코드/스키마 근거 · 전부 실행 검증됨     [전체 선택] [선택 12개 한방에 셋업 →]
대시보드: (● 새 "핵심 KPI" ○ 기존 대시보드 선택)
─ 매출 ────────────────────────────────────────────────
[✓] 일 매출 (Paddle 결제 기준)          ▁▂▅▃▇  🔔 이상탐지 알림 [on]   ✕
    transaction.completed 웹훅이 orders에 적재하는 금액 합계
    근거: 📄 src/webhooks/paddle.ts · 🗄 orders
[✓] MRR                                 42,300,000₩        (알림 없음)   ✕
    ...
─ 퍼널 ────────────────────────────────────────────────
[ ] 가입→결제 퍼널 (track() 4단계)       ▇▅▃▁              추천 배지 없음
```

Row anatomy: checkbox (importance 4–5 pre-checked with a 추천 badge; 1–3 unchecked — a
wall of 25 forced checks is pressure, 8–12 defaults is the sweet spot), title + one-line
description, evidence chips (📄 file · 🗄 table, hover → note), **instant mini preview**
(`WidgetRenderer` on the persisted `sample` — zero live queries on page load), alert toggle
where `alert_config` exists (default on), per-row dismiss (✕ → `status='dismissed'`,
excluded from future re-extractions). Apply → per-item result report (plan-cap partial
failures listed with an upgrade link; applied ones still land) → redirect to the dashboard.

**4. Post-apply — the durable surfaces (retention).** This is where most real exposure
lives, all existing runtime: the "핵심 KPI" dashboard is created `pinned` (top of
`/app/dashboards` + sidebar), widgets live-refresh as usual; alert-enabled KPIs appear in
`/app/alerts` and fire email/Slack with root-cause explanations. `saved_queries.source`
carries the evidence so widgets can later surface "이 지표의 근거" (v1.5).

**5. Staleness loop (re-engagement).** Push webhook marks the catalog `stale` (free, no
LLM): chip shows `오래됨`; re-extraction upserts by key and only *new* proposals return to
the review page as `proposed` (`새 제안 3개` chip). v1.5: a thin banner on the KPI dashboard
("코드가 바뀌었어요 — KPI 다시 추출").

**6. Claude/MCP path (distribution).** `extract_kpis` / `list_kpis` / `apply_kpis` tools so
"레포 분석해서 KPI 대시보드 만들어줘" works end-to-end in a Claude conversation
(`extract_kpis` quota-gated like `ask`); add the scenario to the `/app/mcp` page copy.

## Guardrails (maintenance invariants — do not regress)

- **New LLM entry points MUST call `checkUsageQuota`** (CLAUDE.md invariant): the extract BFF
  route and MCP `extract_kpis`, both → HTTP 402 when over budget; the push webhook does NOT
  auto-extract in v1 (it only marks the catalog `stale`, mirroring context staleness — free).
- One run = one tenant: `dataSourceId`/`repoId` bound in the payload; repo×DB same-org is
  already asserted by the existing code path.
- Secrets stay host-side: installation token minted in the task (never in payload/subprocess);
  DB creds resolved in the parent closure as today. `propose_kpi` itself touches no DB.
- Strictly read-only end to end: proposal-time SQL runs only via `executeReadOnly`; apply-time
  revalidates everything again (`assertReadOnly` + dry-run) before any insert; `createAlert`
  re-asserts on top. Stored catalog SQL is never trusted blindly.
- Caps: apply respects `enforceResourceLimit` (`dashboards`, `widgets_per_dashboard`,
  `alerts_per_org`) with clear partial reporting; extraction counts toward the daily abuse cap
  via the run tables as usual.

## Scope decisions (v1)

1. **SQL sources only** (postgres/mysql/supabase/demo). Firestore v2 — alerts/`buildWidgetSpec`
   are SQL-shaped; the `query.firestore` descriptor exists for later.
2. **Review-then-apply**, not zero-click auto-apply. "한방에" = one click applies N KPIs;
   trust requires the checklist + evidence pass. (Exception: the canned demo catalog may
   auto-apply to the demo dashboard.)
3. **Manual extract button** in v1 (cost control); auto-extract on first repo attach is a
   later flag once cost/quality is observed.
4. **tier-1 is LLM-based** (one agent run) — deterministic template matching without a model
   mis-maps real-world schemas; the run is bounded (`maxTurns`, token budget) like context gen.

## Build plan (4 PRs, each shippable; implementation delegated per advisor/worker protocol)

1. **Foundation** — migration + `db:types`; `src/lib/kpi/{templates,prompt,service}.ts`;
   `KpiSink` + `propose_kpi` in `src/lib/agent/tools.ts`; `RunCodeAnalysisArgs.kpiSink`;
   `trigger/extract-kpis.ts`. Exit: a manually-triggered run lands validated rows in
   `kpi_catalog` (unit tests: propose_kpi validation matrix; prompt renders templates).
2. **BFF + apply** — the three routes (quota gate, caps, shared-validation apply,
   idempotent dashboard). Exit: curl-able extract → review JSON → one-shot apply producing a
   live dashboard + alerts.
3. **UI** — sources chip + review page + onboarding step. Exit: full in-product loop.
4. **Distribution** — MCP tools, webhook staleness, demo canned catalog.

Deploy notes: new Trigger task ⇒ `npx trigger.dev deploy` required (Vercel deploy alone
leaves `extract-kpis` inert). **No new env vars** on either runtime.

## Deferred (explicitly not v1)

Firestore sources; auto re-extract on push (staleness only); scheduled KPI re-baselining;
per-plan KPI-count differentiation; weekly-digest integration ("이번 주 KPI 하이라이트");
multi-repo merge for one source.
