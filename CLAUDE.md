# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Supalens (supalens.ai) — an AI data operator for small SaaS teams on Supabase/Postgres: connect a
DB read-only (+ optionally a GitHub repo), it proposes KPIs from the code and schema, runs approved
monitors, and investigates anomalies into Slack/email. Next.js 15 App Router + React 19 + Supabase
(auth + app DB) + Trigger.dev (every LLM agent runs there, never on Vercel). Three surfaces:
localized marketing site (`src/app/[locale]/`, incl. the public repo scanner `/x`), the product under
`/app/*`, and machine surfaces (`/api/*`, MCP at `mcp.supalens.ai`). `AGENTS.md` is a short
contributor summary.

## Development Commands

### Core Development
- `npm run dev` - Start development server at http://localhost:3000
- `npm run build` - Production build
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Testing
- `npm test` - Run unit/integration tests once (Vitest)
- `npm run test:watch` - Vitest watch mode
- `npx vitest run <path>` - Run a single test file (e.g. `src/lib/crypto/kek.test.ts`)
- `npx vitest run -t "<name>"` - Run only tests matching a name
- Naming: `*.test.ts` = unit (e.g. `crypto/kek.test.ts`, `query/guard.test.ts`); `*.integration.test.ts`
  needs a live DB via `TEST_PG_URL` / `TEST_MYSQL_URL` (e.g. `query/execute.integration.test.ts`)
- Typecheck: `npx tsc --noEmit -p .` (no npm script; `next build` is the only other full check —
  don't run it while the owner's `:3000` dev server is up)
- E2E is separate (Playwright, boots the app on port 2000, needs Docker for local Supabase) — see
  [E2E Testing](#e2e-testing) below; CI runs it on PRs to `main` (`.github/workflows/e2e.yml`)

### Working in this repo
Stage and commit with explicit paths, keep one change per commit, and use the commit style
`feat(scope): …` / `fix(scope): …` / `docs:` / `chore:`. There is no Prettier config: match the
surrounding file's quote/semicolon style. New tables must reach the database (`db:push`) before
code that reads them ships. CI (`.github/workflows/`) runs on Node 20. Before pushing, run
`node scripts/check-public-tree.mjs` — the repository is public, and that script fails on
internal identifiers, runbooks and credentials.

### Supabase Local Development
- `npm run supabase:start` - Start local Supabase instance
- `npm run supabase:stop` - Stop local Supabase instance
- `npm run supabase:status` - Check Supabase status

### Database Management
- `npm run db:new <migration_name>` - Create new migration
- `npm run db:reset` - Reset local database
- `npm run db:push` - Push migrations to remote
- `npm run db:pull` - Pull schema from remote
- `npm run db:diff` - Generate diff for schema changes
- `npm run db:lint` - Check schema for errors and anti-patterns
- `npm run db:dump` - Backup database to supabase/dump.sql
- `npm run db:link` - Link to the Supabase project in `SUPABASE_PROJECT_REF`
- `npm run db:types` - Generate TypeScript types → `src/utils/supabase/schema.type.ts`

**Important:** `db:link`/`db:types` read `SUPABASE_PROJECT_REF` from the shell (npm does not load `.env.local`). Run `db:types` after **every** migration so new tables get generated types (the user-JWT `createClient` is typed; the service-role `admin` client is untyped, so new-table queries through it compile before `db:types` but should still be regenerated).

## Editions and deployment

**One codebase, two editions** — `src/config/edition.ts` (`isCloud()` / `isSelfHosted()`, from
`NEXT_PUBLIC_SUPALENS_EDITION`). `cloud` is the hosted service (marketing site, Paddle billing,
public demo, X-ray, support chat). `selfhost` is the product only: the middleware redirects every
marketing/legal path to `/app`, hosted-only machine surfaces 404, every org resolves to the
unlimited plan (`getPlanLimits` / `entitledPlan`), and the tasks in `trigger/cloud/` never run.
**Any hosted-only behaviour must be gated on `isCloud()`** — a self-hosted install must never
expose billing, marketing pages or an anonymous LLM endpoint. Pinned by
`src/config/edition-gates.test.ts`. Absolute links come from `appOrigin()` in the same file; never
hard-code a domain. Self-hosting guide: [docs/self-hosting.md](./docs/self-hosting.md).

**Self-hosted = Docker + an Anthropic key, nothing else.** Rules that keep it that way:
- **No avoidable outside service.** Nothing in the self-hosted path may require an account with a
  SaaS, and the browser makes no third-party request (fonts are bundled; analytics are cloud-only).
- **Internal accounts, one workspace.** Email + password only (`auth-methods.ts` ignores the env on
  self-host). The first visitor creates the owner at `/setup` (`src/app/setup`, only while
  `instanceHasUsers()` is false); after that admins create accounts and reset passwords from
  Settings → Team (`createMemberAccount` / `resetMemberPassword` in `src/lib/org/actions.ts`, via
  `src/lib/instance/accounts.ts` and the service role). Public sign-up is off in GoTrue.
  `ensurePrimaryOrg` never creates a workspace on self-host (→ `/no-workspace`), and
  `create_organization` refuses a second org once `instance_settings.single_workspace` is set.
- **Optional integrations are hidden until registered.** `integrationAvailability()`
  (`src/lib/integrations/availability.ts`, server) → `IntegrationsProvider` in the `/app` layout →
  `useIntegrations()` in client components. Supabase OAuth, the GitHub App, the Slack app and
  email are all optional; a connect button for an unregistered one is a bug. Direct database
  connection is the default path. Client components import from `integrations/types.ts`, never
  `availability.ts` (it pulls in the mail and provider modules).
- **Tasks run in the web server.** `src/lib/tasks/builtin/*` implements the slice of
  `@trigger.dev/sdk` and `@trigger.dev/react-hooks` this codebase uses (queue with per-key
  concurrency, `metadata.stream` → SSE at `/api/tasks/runs/[id]/events`, cron ticker, boot-time
  reaper). `next.config.ts` aliases both packages to it when the build is self-hosted and
  `SUPALENS_TASK_BACKEND` is not `trigger` — so task files in `./trigger` and all call sites are
  shared verbatim with the hosted edition. A new task file must be added to
  `builtin/load-tasks.ts` (pinned by `builtin.test.ts`); a new SDK feature used anywhere must be
  added to `builtin/sdk.ts`. The runner is in-memory: not durable, single instance.
- **Bundled stack** (`docker-compose.yml`, `selfhost/`, `./selfhost.sh`): Caddy gateway + web +
  Supabase's Postgres, GoTrue and PostgREST + a one-shot `migrate`. The browser reaches Supabase on
  the app's own origin; the server uses `SUPABASE_INTERNAL_URL` with a fixed cookie name
  (`src/utils/supabase/env.ts` — every client factory goes through it).
- **The model provider is configuration.** Runners and tool modules import `tool`,
  `createSdkMcpServer` and `query` from `src/lib/llm/agent-sdk.ts` — never from
  `@anthropic-ai/claude-agent-sdk` (pinned by `src/lib/llm/llm.test.ts`). `LLM_PROVIDER=anthropic`
  (default) delegates to the Agent SDK with the subprocess lockdown; `LLM_PROVIDER=openai` runs
  `src/lib/llm/openai-loop.ts` against any OpenAI-compatible endpoint with the SAME tools and
  allow-list, yielding the message shapes in `src/lib/llm/messages.ts`. A provider with another
  wire format = one new loop module + a branch in `agent-sdk.ts`; runners, tools and prompts stay
  untouched. Model tiers resolve in `src/lib/llm/provider.ts::resolveModels`.
- **Mail** is one seam, `getResendClient()` in `src/lib/email/resend.ts`: `SMTP_URL` (nodemailer)
  or Resend. UI must use `emailConfigured()` before claiming email is delivered.

**Two deploy lifecycles — do not conflate them.** The web server (a Docker image, or a platform
build such as Vercel) serves all routes, the UI and the BFF. The Trigger.dev host is deployed
SEPARATELY via `npm run trigger:deploy` (a package.json script that auto-pins the CLI to the
installed `@trigger.dev/sdk` version, so it can't drift into a CI-mode version-mismatch abort) —
until you run it, every `schedules.task` cron in `trigger/` and every task runs STALE code; a web
deploy does NOT touch the Trigger host. The CLI evaluates `trigger.config.ts` in its own process
and needs `TRIGGER_PROJECT_REF` and `NEXT_PUBLIC_SUPALENS_EDITION` in `.env` (or `--env-file`).
The task runtime is pinned in `trigger.config.ts` (`runtime: 'node-24'`, guarded by
`src/lib/trigger-runtime.test.ts`) — never leave it unset. A var used by BOTH runtimes
(`SUPABASE_SERVICE_ROLE_KEY`, `KEK_*`, `ANTHROPIC_API_KEY`, `DEMO_DATABASE_URL`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPALENS_EDITION`) must be set on the web server AND on the
Trigger host.

## Architecture

### Supabase Integration Pattern

The project uses Supabase SSR (@supabase/ssr) with separate client configurations for different contexts:

**Server Components** (`src/utils/supabase/server.ts`):
- Use `createClient()` from `@/utils/supabase/server`
- Async function that reads cookies via Next.js `cookies()`
- Handles session management server-side

**Client Components** (`src/utils/supabase/client.ts`):
- Use `createClient()` from `@/utils/supabase/client`
- Browser-based client using `createBrowserClient`
- For client-side auth and data fetching

**Middleware** (`src/utils/supabase/middleware.ts` + `src/middleware.ts`):
- Automatically refreshes auth tokens on every request
- The `updateSession()` function maintains user sessions
- Applies to all routes except static files and images

**Provider** (`src/utils/supabase/provider.tsx`):
- Wraps the app in src/app/layout.tsx
- Auto-refreshes router on `SIGNED_IN` auth events
- Hooks:
  - `useSupabase()` - Returns Supabase client or `null` if not configured
  - `useSupabaseRequired()` - Returns Supabase client or throws if not configured

**Important:** All `createClient()` functions return `null` if environment variables are missing. This allows the app to run without Supabase for local development. Always handle the null case or use `useSupabaseRequired()` when Supabase is required.

### Modal System

Uses a layered modal architecture based on shadcn/ui Dialog (Radix UI):

**Base Layer** (`src/components/ui/dialog.tsx`):
- Raw shadcn/ui Dialog primitives
- Full accessibility support (focus trap, ESC key, aria attributes)

**Application Layer** (`src/components/modals/`):
- `BaseModal` - Configurable wrapper with size variants (sm/md/lg/xl/full), title, description, footer
- `ConfirmModal` - Confirmation dialog with confirm/cancel buttons, loading state, destructive variant
- `AlertModal` - Simple alert with single confirm button

Usage:
```tsx
import { BaseModal, ConfirmModal, AlertModal } from '@/components/modals';
```

### Configuration Pattern

Config files in `src/config/` manage non-sensitive application settings:
- `client.ts` - Client-side config (exposed to browser)
- `server.ts` - Server-only config with `import 'server-only'` guard

**Usage:**
- Client: `import { clientConfig } from '@/config'`
- Server: `import { serverConfig } from '@/config/server'`

**Important:** Supabase credentials are managed via environment variables directly (not in config files) for security.

### Import Aliases

TypeScript configured with `@/*` pointing to `src/*`

### UI Components

Uses shadcn/ui pattern with components in `src/components/ui/`. Utility function `cn()` in `src/lib/utils.ts` combines clsx and tailwind-merge for className management.

### Security Headers

Security headers are configured in `next.config.ts`:
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- X-XSS-Protection: 1; mode=block

### Environment Variables

Required environment variables (create `.env.local`):
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `NEXT_PUBLIC_GAID` - Google Analytics ID
- `SUPABASE_DB_PASSWORD` - Database password (for Supabase CLI commands)

## Key Implementation Details

### Authentication Flow
When implementing auth features, always use the appropriate Supabase client:
- Server Actions/Components: import from `@/utils/supabase/server`
- Client Components: import from `@/utils/supabase/client`
- Never mix client and server clients

### Type Generation
After modifying Supabase schema, run `npm run db:types` to regenerate TypeScript types at `src/utils/supabase/schema.type.ts`

### Middleware Behavior
The middleware refreshes user sessions on every request. If implementing protected routes, extend `updateSession()` in src/utils/supabase/middleware.ts.

## App UI system

`/app/*` uses one product design system: warm neutral greys,
one sky-deep accent, DM Sans UI at weight 500, serif page titles and headline figures, 16px cards with a
fine line, tinted sidebar/table heads.
Tokens + `.dx-*` primitives live in `src/app/app/dashboard.css`, scoped to `html:has([data-surface="app"])`
(the shell sets `data-surface="app"`; `/dev` previews without the shell wrap views in `AppSurface`) — never
put app tokens on `:root`. Shell = `AppSidebar` (240px rail collapsible to 56px via
`html[data-sidebar]` + localStorage, flat labeled nav groups incl. Settings pages, account row whose menu
holds org switcher/theme/terms/privacy/sign-out); no desktop top bar; ≤900px `AppTopbar` opens the rail as
a drawer. IA in `src/components/dashboard/nav.ts`.

## Supabase Account Integration ("Connect Supabase")

Lets a user connect their **own** Supabase account so supalens can read their project DBs.
Uses the Management API OAuth 2.0 + PKCE flow (api.supabase.com/v1/oauth/*). Full design:
[docs/supabase.md](./docs/supabase.md) (OAuth flow) and [docs/db-schema.md](./docs/db-schema.md) (data model).

Data model (migrations in `supabase/migrations/2026062910*`):
`organizations → provider_connections → data_sources → secrets`, plus `data_encryption_keys`,
`secret_access_log`, `api_keys`, `credential_revocations`, `audit_log`, schema cache. RLS is on for
every table; `secrets`/keys are blocked from client roles (service_role only).

Key modules:
- `src/utils/supabase/admin.ts` — service-role client (BYPASSRLS). Server-only; never import client-side.
- `src/lib/crypto/{kek,envelope}.ts` — envelope encryption. Per-tenant DEK (AES-256-GCM, AAD-bound
  to the row) wrapped by a KEK (`KEK_PROVIDER`=local for dev / gcp_kms for prod).
- `src/lib/secrets/service.ts` — vault: `putSecret`/`revealSecret`/`casUpdateSecret`/`revokeSecret` + audit.
- `src/lib/supabase-oauth/*` — `config`, `pkce`, `client` (exchange/refresh/revoke), `tokens`
  (`getValidAccessToken` w/ single-use rotation + reuse detection), `connect`, `disconnect`.
- `src/lib/supabase-management/*` — Management API client + `mintReadonlyRole` (mints `supalens_ro`).
- Routes: `src/app/api/connect-supabase/{authorize,callback}/route.ts`; UI: `src/app/app/settings/integrations/`.

App routes live under `/app/*` (umbrella): `/app/ask` (the core NL analysis, hero), `/app/sources`
(data sources), `/app/dashboards`, `/app/alerts`, `/app/mcp`, `/app/settings/{,billing,members,integrations}`.
`/app` redirects to `/app/ask`. Marketing stays at `/`. (No `/dashboard` or top-level `/settings`.)

Required env (see `.env.example`): `SUPABASE_SERVICE_ROLE_KEY`, `SUPA_CONNECT_CLIENT_ID/SECRET/REDIRECT_URI`,
`KEK_PROVIDER` + `KEK_LOCAL_MASTER_KEY` (or `KEK_GCP_KEY`). **`SUPA_CONNECT_*` is also needed on the
Trigger.dev host** for the connect-time `bootstrap-supabase-projects` task (it refreshes the
Management-API token from the stored refresh token on the host — without the env the task fails and a
fresh connection ends up with zero sources). The integrations-page "프로젝트 다시 동기화" resync
deliberately runs INLINE on the BFF instead (`resyncSupabaseProjects`) so it works wherever the OAuth
callback works. Register the OAuth app in
Supabase Dashboard → Organization settings → OAuth Apps. **DB password is never retrievable via the
Management API** — supalens mints a read-only `supalens_ro` role per project and stores that password.

## AI Analysis Agent (Claude Agent SDK on Trigger.dev)

LLM reasoning over a user's connected DB. Design + topology: [docs/agent-implementation-plan.md](./docs/agent-implementation-plan.md),
[docs/agent-architecture.html](./docs/agent-architecture.html). **The agent runs on Trigger.dev, NOT on Vercel**
(the SDK spawns a `claude` subprocess + long-running loop). Vercel is a thin BFF that triggers runs and
mints run-scoped tokens; the browser subscribes to the Trigger.dev Realtime stream directly.

Flow: `POST /api/agent/analyze` (BFF: auth + membership → insert `agent_runs` → `tasks.trigger("analyze")`
→ return run id + public token) → `trigger/analyze.ts` (Agent SDK `query()` + in-process SQL tools) →
tenant DB. Browser: `src/components/agent/AgentStream.tsx` via `useRealtimeRunWithStreams`.

Modules:
- `src/lib/query/*` — read-only query engine (guard SELECT-only + READ ONLY tx + statement_timeout +
  row cap + audit). Shared by the agent, dashboards, MCP. **Two transports** (`dsn.ts` decides):
  Supabase-OAuth sources route through the Management API (`supabase-api.ts` — owner-level
  `read_only: true`, so tenant RLS does NOT zero out results; system schemas are hidden from
  introspection and lexically deny-listed in SQL, a best-effort guard — the pooler's structural
  denial doesn't exist on this path); every other SQL source resolves `supalens_ro`/direct creds
  from the vault and connects via the pooler. The API transport needs a per-query access token:
  `tokens.ts::getCachedAccessToken` (cached + single-flighted — NEVER call `getValidAccessToken`
  per query, it rotates the refresh token every call).
- `src/lib/agent/{system-prompt,tools,run-analysis}.ts` — the locked-down agent: ONLY the in-process
  tools `execute_sql`/`get_schema`/`propose_visualization` (+ `propose_kpi` when a KpiSink is passed —
  see Visualization Widgets / Auto-KPI below), `tools:[]` + `disallowedTools` (no Bash/FS/web),
  `canUseTool` deny-gate, `permissionMode: 'dontAsk'`, env-isolated subprocess (no DB/KMS creds),
  `maxTurns` + token-budget abort.
- `trigger/analyze.ts` + `trigger.config.ts` — Trigger task (per-data-source concurrency cap).
- `supabase/migrations/20260629110000_agent_runs.sql` — run records (RLS: members read; service_role writes).

Security invariants (do not regress): one run = one tenant (dataSourceId bound in payload, not chosen by
the model); secrets live only on the agent host (parent process closure), never in the model context or
subprocess; the agent is strictly read-only (writes go through separate authorized paths).

Env (set on the Trigger.dev host): `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `KEK_*`.
Env (Next.js BFF): `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_REF`. Deploy the task with `npm run trigger:deploy`.

## Visualization Widgets (agent-driven charts)

Product thesis: the agent doesn't just answer in prose — it CHOOSES a chart and its config.
One declarative spec flows through every layer with no adapter between them. Full design +
4-step build plan: [docs/widgets-architecture.html](./docs/widgets-architecture.html).

**Single source of truth — `src/lib/viz/spec.ts`** (zod; no React/server imports, so the
agent, the renderer, and the future persistence layer all import it). `VisualizationSpec` is
an envelope `{ v, query:{sql,queryId?}, sample?, chart }` where `chart` is `ChartSpec`, a
`discriminatedUnion('type')` of 12 types (kpi, bignumber, bar, stackedBar, groupedBar, line,
multiLine, area, pie, donut, scatter, table). Encodings reference result columns BY NAME (the
agent only ever sees `{columns, rows}`). `format.ts` = `formatValue` (ko-KR). Helpers:
`referencedColumns`, `buildDefaultTableSpec`, `migrateSpec` (versioned via `SPEC_VERSION`).

**Agent side — `src/lib/agent/`.** `tools.ts` adds an in-process `propose_visualization
({queryId, chart})` MCP tool next to `execute_sql`/`get_schema`; `execute_sql` now also
returns a `queryId` and stashes its result in a closure `Map`. The tool validates that every
referenced column exists (else it returns the valid-column list so the model self-repairs)
and `safeParse`s the spec. It reads ONLY that in-memory map — no DB/pool/vault access — so
the read-only lockdown invariants in `run-analysis.ts` are unchanged (it is simply added to
`ALLOWED_TOOLS` + `canUseTool`). Accepted specs stream as a new `AnalysisChunk` variant
`{type:'visualization', spec}`, are collected on `AnalysisResult.visualizations`, and persist
into `agent_runs.result`. If a run yields data but no chart, a default `table` spec is
synthesized server-side.

**Stream → UI.** Both transports forward chunks verbatim — the local SSE route
(`/api/agent/runs/[id]/stream`) and the Trigger.dev Realtime stream (`AgentStream`) — so the
new variant needed no transport change. `AgentView` renders each viz chunk via `WidgetRenderer`.

**Widget library — `src/components/dashboard/widgets/`.** `<WidgetRenderer spec data />` is
the single entry point: it validates (accepts a full `VisualizationSpec` envelope OR a bare
`ChartSpec`), then `registry.tsx` maps `spec.type` → component. Data-driven charts use
**Recharts 3** and are lazy-loaded (`next/dynamic`, `ssr:false`, height-reserving skeleton —
ResponsiveContainer needs the DOM) so KPI/table-only views never ship the charting bundle;
KPI/BigNumber/Table are pure CSS/SVG. The widgets are intentionally **self-contained**: they
style off the GLOBAL CSS variables in `globals.css` (`--clay`, `--paper-2`, …), NOT the
`.dx-*` utility classes — those live in `src/app/app/dashboard.css` and load only under the
`/app` layout. That is why a widget renders identically in `/app/dashboards` and the dev
gallery.

**Dev gallery — `src/app/dev/dashboard/widgets/`** (dev-only; `notFound()` in production).
Renders every type from `__fixtures__/samples.ts` (incl. empty/truncated edge cases) so charts
are built and eyeballed before live wiring: `npm run dev` → `/dev/dashboard/widgets`.

**Saved-dashboard persistence (BUILT):** `dashboards` / `saved_queries` / `dashboard_widgets`
tables (`supabase/migrations/20260630120000_dashboards.sql` + `20260709090000` adds
`dashboard_widgets.deleted_at`), `src/lib/dashboards/*` (`addWidgetToDashboard`;
`getDashboardBySlug` re-runs EVERY widget with a `data_source_id` via `runWidgetData` —
`unstable_cache`d per widget, `refresh_interval`/60s revalidate; the stored `sample` column is a
creation-time FALLBACK used when the re-run fails, and the persisted `spec` jsonb is stored
`withoutSample()`), and the `/app/ask` → "위젯 추가" bridge (`AddToDashboard.tsx`, which threads the
run's `dataSourceId` so saved widgets stay re-runnable). A persisted widget stores the same
`VisualizationSpec` and re-runs `query.sql` through `executeReadOnly` — or, for a Firestore source,
`query.firestore` through `queryDocuments` (see Firestore Connector below). `WidgetRenderer` is the
single envelope entry point: it runs `migrateSpec` (version upcasts) and validates
`referencedColumns` against the data (schema drift → visible error card, not '—' cells).

## GitHub Integration ("Connect GitHub" + code-analysis agent)

Connect a user's GitHub repos so supalens can `git clone` them for AI **code analysis** and detect
commits via **webhooks**. Built as a **GitHub App** (not an OAuth App) — only the App model expresses
read-only code access (`Contents: Read`), one central webhook for the whole fleet, and per-installation
repo scoping. Full design + build state: [docs/github.md](./docs/github.md). Deliberately mirrors the
Supabase-OAuth connect flow and the Trigger.dev agent topology.

**Three distinct "GitHub auths" — do NOT conflate** (see docs/github.md): (1) GitHub *login* = a
Supabase Auth provider (`signInWithOAuth({provider:'github'})` → `/auth/callback`) for identity;
(2) GitHub *App installation* (`/api/connect-github/*`, installation token) for clone+webhook — **this
is the integration**; (3) App user-to-server (only if merging 1+2). v1 implements (2) only. **Never
clone with a login token** — clone uses installation tokens exclusively.

Data model (migration `supabase/migrations/20260630130000_github_integration.sql`): `provider_connections`
gains `provider='github'` + `installation_id`; new `github_repositories`, `code_analysis_runs` (mirrors
`agent_runs`), `github_webhook_events` (delivery-id idempotency). **v1 stores NO tenant secret** — the App
private key is a host env var (GCP Secret Manager in prod), installation tokens are minted on demand and
cached in memory; the only per-tenant datum is the non-secret `installation_id`.

Modules:
- `src/lib/github-app/*` — `config`, `app-jwt` (RS256 App JWT via Node `crypto`, no `jsonwebtoken` dep),
  `installation-token` (1h token; in-memory TTL cache + in-flight dedup to avoid the legacy token-cache
  race), `client` (api.github.com), `connect`/`disconnect`. **Not `server-only`** (shared with the Trigger
  runtime, like `utils/supabase/admin.ts`).
- `src/lib/repo/clone.ts` — host-side `git clone` with **GIT_ASKPASS** token injection (token never in
  argv / clone URL / `.git/config`), shallow `--depth 1 --single-branch`, optional blobless + sparse.
- `src/lib/code-agent/*` — sibling of `src/lib/agent/*` with the **inverse tool profile**: jailed
  in-process file tools (`list_files`/`read_file`/`grep_code`/`get_diff` — read-only, path-jailed,
  secret-redacting, ripgrep-backed) instead of SQL. Same lockdown (`tools:[]`, `disallowedTools`,
  `settingSources:[]`, `permissionMode:'dontAsk'`, env-stripped subprocess) — **no-execute is structural**
  (no tool builds/installs/runs the repo). When `dataSourceId` is bound, the read-only SQL tools are added
  for **code × DB cross-analysis** (schema/migration drift, dead queries) — the BFF asserts same `org_id`.
- `trigger/analyze-code.ts` — Trigger task. Mints the installation token **on the host** (never in the BFF
  payload or the subprocess), clones, runs the agent, streams via `metadata.stream('agent', …)`.
- Routes: `/api/connect-github/{authorize,callback}` (state CSRF + server-verify the `installation_id`),
  `/api/code/analyze` (BFF; **Trigger required — no Vercel-inline fallback** since cloning needs a
  subprocess+disk), `/api/github/webhook` (HMAC-SHA256 verify on the **raw** body + delivery-id idempotency
  + push → incremental run).
- UI: `src/app/app/settings/integrations/` — GitHub card + per-repo analysis toggle (`GithubReposList.tsx`);
  the run streams reuse `AgentStream`/`AgentView`. Auth-free dev preview at `/dev/integrations`.

Security invariants (same as the SQL agent, do not regress): one run = one tenant (`repoId`/`installationId`
bound in the payload; combined runs assert code/DB same `org_id`); the installation token lives only on the
agent host (clone closure), never in the model context or subprocess; strictly read-only — cloned repo
content is UNTRUSTED and is never built/installed/executed.

Env (Trigger host): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (+ existing `ANTHROPIC_API_KEY`/`KEK_*`).
Env (BFF): `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` (callback verify),
`GITHUB_APP_SLUG`. Register the App in GitHub → Developer settings → GitHub Apps (permissions: Metadata
+ Contents read; subscribe: push). Deploy the task with `npm run trigger:deploy`.

## Firestore Connector (Firebase document DB as a data source)

Connect a user's **Firebase Firestore** as a data source alongside SQL (postgres/mysql). Firestore is a
NoSQL **document** store, not SQL — so it is a new data-source *family*, built as a **parallel module**
(the way `code-agent` is to `agent`), NOT a refactor of the SQL query engine (`src/lib/query/*` is
untouched). Full design + build state: [docs/firestore-connector-plan.md](./docs/firestore-connector-plan.md).

**The one seam that lets it reuse everything else: `flatten`.** `src/lib/firestore/flatten.ts` turns
heterogeneous documents into the SAME `{columns, rows}` `QueryResult` contract the SQL engine returns
(nested → dot notation `address.city`; `__id` = doc id; arrays → JSON string; Timestamp/GeoPoint/
DocumentReference → string). So the entire viz / widget / stream / persistence stack is reused unchanged;
only the read + reasoning layers are new.

Data model (the polymorphic `data_sources` absorbs it — no structural migration): `ds_engine +=
'firestore'`, `ds_provider += 'firebase'`, `secret_kind += 'gcp_service_account'` (migrations
`supabase/migrations/20260702100*` — the `ALTER TYPE ADD VALUE` and the CHECK change are in SEPARATE
files because a new enum value can't be used in the same tx). `config = {project_id, client_email,
database_id}` (non-secret); the **service-account JSON goes to the vault** (`gcp_service_account`), never
`config` (the `reject_secret_keys` trigger blocks `private_key`). `connection_id` is null (a direct
source, like Direct DB) — connecting = one `data_sources` row, immediately queryable (no separate
"account" step like Supabase OAuth).

Modules (parallel to `src/lib/query/*` and `src/lib/agent/*`; **not `server-only`** — shared with Trigger):
- `src/lib/firestore/*` — data-access layer: `resolve` (creds + TTL cache, **no SSRF** — Google API, not
  a user host), `client` (`@google-cloud/firestore` client cache), `query`/`aggregate` (hard row cap +
  `count/sum/average`), `introspect` (Firestore has NO schema catalog → sample docs + infer fields),
  `flatten`, `probe` (`listCollections` connection test — the `select 1` equivalent).
- `src/lib/firestore-agent/*` — mirrors `agent/*` lockdown VERBATIM; document tool profile
  (`list_collections`/`get_collection_schema`/`query_documents`/`aggregate`) + reused
  `propose_visualization`. `trigger/analyze-firestore.ts` mirrors `trigger/analyze.ts`.
- `src/lib/data-sources/register-firestore.ts` — probe → insert `data_sources` → vault. `validate.ts`
  adds `firestoreDataSourceSchema` (**additive** — the SQL path is untouched; `/api/data-sources` branches
  on `body.type==='firestore'`). UI `FirestoreDataSourceForm.tsx` (JSON file upload OR paste).

**Dispatch by engine is CENTRALIZED (was three hardcoded places):** cross-process dispatch =
`src/lib/agent/engine.ts::taskIdForEngine` (BFF, MCP `ask`); in-process = `src/lib/agent/run-by-engine.ts::runByEngine`
(SSE route, messenger-answer, weekly digest). Both are WHITELISTS over `src/lib/data-sources/engines.ts`
(`isSqlEngine`/`isDocumentEngine`) and THROW on an unregistered engine — every other per-engine branch
(MCP `resolveSqlDataSourceId`, KPI extract, context `withDb`, introspect-cache, alerts creation/runner,
`query/dsn.ts`) also whitelists via `engines.ts`, so engine #3 fails closed at each seam it hasn't been
added to instead of silently running the SQL path. Dashboard live-refresh (`runWidgetData`) branches on
`VisualizationSpec.query.firestore` (structured re-run descriptor) vs `query.sql`.

MCP: the SQL tools (`execute_sql`/`get_schema`/`register_query`/`create_dashboard`/`add_widget`) reject
Firestore sources via `resolveSqlDataSourceId` (clear message → "use `ask`"); the parallel document tools
(`list_collections`/`query_documents`/`aggregate`) resolve via `resolveFirestoreDataSourceId`. Note the web
`/app/ask` picker reads ALL active `data_sources` with no engine filter, so a Firestore source appears
automatically, and `/app/sources` is the real management surface (see Data-Source Context below).

Security invariants (same as the SQL agent): read-only is **structural** (no write tool exists) + IAM
`roles/datastore.viewer`; the decrypted service-account key lives only on the agent host (tool-handler
closure), stripped from the subprocess env; **aggregate-first + hard row caps** because Firestore bills per
document read. Firestore also has NO joins / GROUP BY — positioned as operational insight, not full BI.

Env: reuses `SUPABASE_SERVICE_ROLE_KEY`/`KEK_*`/`ANTHROPIC_API_KEY` — **no new host secret** (the per-tenant
service account lives in the vault). Deploy `npm run trigger:deploy`; `trigger.config.ts` sets
`build.external: ['@google-cloud/firestore']` (google-gax/protobufjs load assets via dynamic require and
don't bundle cleanly under esbuild).

## Data-Source Context (SUPALENS.md — code-aware query context)

Each data source can carry a durable, AI-authored context doc ("SUPALENS.md") injected as a **TRUSTED**
system-prompt section into the query agent (SQL + Firestore) to lift NL→query accuracy — the product's
"the code is context" thesis. Reuses the SAME sandbox topology as the agents (Trigger.dev, NOT E2B).

**Two tiers of generation:**
- **tier-1 (no repo)** — deterministic schema digest from the introspection cache.
  `src/lib/context/baseline.ts::generateBaselineContext`, auto-run at the end of `syncSchemaCache`
  (guarded: won't clobber a repo-derived doc — marks it `stale`; keyed on the LIVE `data_sources.repo_id`
  so detaching a repo lets the baseline take over again).
- **tier-2 (repo attached)** — clone the attached repo + run the code×DB agent to author a code-aware doc.
  `src/lib/context/generate.ts` reuses `runCodeAnalysis` VERBATIM (a `withDb` flag gates the SQL tools so a
  Firestore source runs code-only) via `trigger/generate-context.ts` (mirrors `trigger/analyze-code.ts`).

**Modules:**
- `src/lib/context/service.ts` — `getSourceContext` / `putSourceContext` / `renderSourceContextSection`
  (TRUSTED section, 24k-char cap) / `markContextGenerating` / `markContextFailed`. Table
  `data_source_context` (`supabase/migrations/20260702110000`; member-read RLS `dsc_sel`, service_role-write);
  read/written via the untyped `createAdminClient()` on the agent host — **not `server-only`**.
- `src/lib/data-sources/introspect-cache.ts::syncSchemaCache` — populates the previously-dormant
  `data_source_schemas` / `data_source_objects` (SQL via `query/introspect`, Firestore via `firestore/introspect`);
  wired best-effort into both register flows; manual re-sync `POST /api/data-sources/[id]/introspect`.

**Injection point (change BOTH together):** `src/lib/agent/run-analysis.ts` and
`src/lib/firestore-agent/run-firestore-analysis.ts` set `systemPrompt = BASE + renderSourceContextSection(ctx)`.
This funnels ALL entry paths (BFF, MCP `ask`, local SSE) since they call these run functions. The injected
block is TRUSTED; runtime tool rows stay **UNTRUSTED** — keep that boundary intact.

**Repo attach + BFF:** `data_sources.repo_id` FK (`supabase/migrations/20260702120000` + a same-org DB
trigger `app.assert_repo_same_org`); `PATCH /api/data-sources/[id]` `{repoId}` attaches/detaches;
`GET/POST /api/data-sources/[id]/context` (POST: no repo → tier-1 inline, repo → tier-2 trigger).

**Plan policy (tier-2 = real LLM cost — a push is a SIGNAL, not a trigger):** free = ONE lifetime tier-2
extraction per org (spent by the attach auto-run; durable counter `organizations.context_extractions_used`,
incremented on SUCCESS only via the `increment_context_extractions()` RPC — deliberately NOT derived from
prunable `agent_runs`; enforcement gated on `billingActive()`, mirroring checkUsageQuota's strand-avoidance
rule); push auto-regen only on plans with a non-zero `context_auto_regen_cooldown_hours` (standard 24h /
premium 6h; free/basic = `markContextStale` only, mirroring the KPI push-staleness pattern — the stale doc
keeps injecting). Pure decisions in `src/lib/context/policy.ts` (`canExtractContext`/`shouldAutoRegenContext`,
pin-tested); io in `service.ts` (`getContextPlanState`/`markContextStale`/`incrementContextExtractions`);
enforced at the 3 tier-2 entry points: context POST → 402 `{error:'context_limit'}`, PATCH attach →
`contextGenerationSkipped:'context_limit'`, push webhook → cooldown branch in `regenerateAttachedContext`.
Manual regen has NO cooldown (explicit intent; bounded by the monthly query quota). Migration
`20260723091237` (column + RPC + guard-trigger list extended).

**UI:** `/app/sources` is now the REAL, canonical management surface (was a static mock) — `page.tsx` +
`SourcesClient.tsx` (real list + connect modal + delete + 스키마 동기화 + 레포 attach chip + 컨텍스트 chip/viewer).
`/app/settings/integrations` keeps OAuth/GitHub connect. No new env; deploy the task with `npm run
trigger:deploy` (the script auto-pins the CLI to the installed `@trigger.dev/sdk` version, avoiding the
CI-mode version-mismatch abort).

## Alerts (metric monitors + email notification)

Registered SQL-condition monitors: run a scalar `metric_sql` on a schedule and email the org
owners/admins when the value satisfies `operator` vs `threshold`. Migration
`supabase/migrations/20260701120000_alerts.sql` — `alerts` + `alert_events`. Evaluation is
deliberately **type-agnostic** (threshold/change_rate both reduce to the same scalar compare) so the
runner **never needs the LLM**; `type` is a UI label only.

- `src/lib/alerts/evaluate.ts` — PURE decision logic (no io): `conditionMet` (6 operators),
  `decideTransition` (edge-triggered firing with hysteresis `fire_threshold` + `cooldown_seconds`, so a
  value hovering at the threshold never spams — notify only on normal→firing / firing→normal edges past
  cooldown), `scalarFromRows`. Fully unit-tested (`evaluate.test.ts`).
- `src/lib/alerts/runner.ts` — the io shell (service-role admin client). Runs `metric_sql` through
  `executeReadOnly` (read-only, capped, audited — same engine as the agent/dashboards), applies the pure
  decision, persists per-alert state, inserts a fired/resolved `alert_event`, and notifies. Recipients =
  org owner/admin **verified** emails only (never free-text → not an exfil channel). Idempotent + edge-
  deduped, so retries are safe.
- `src/lib/email/alert.ts` — `sendAlertEmail`, same contract as the invite email (server-only, lazy
  Resend, NEVER throws).
- `trigger/evaluate-alerts.ts` — `evaluate-alerts-cron` (*/5) discovers data sources with enabled alerts
  and fans out one child run per data source (`concurrencyKey: dataSourceId`, mirroring `analyze.ts`) so
  one slow/hostile tenant DB can't starve others. Unlike the agent task, retries ARE enabled here.
- `src/lib/alerts/{actions,server}.ts` — user-JWT CRUD. RLS `alerts_write` = member+ (viewer EXCLUDED,
  matching `ds_write`, since a viewer authoring an alert is a data-exfil path). Extra defenses RLS can't
  express: `metric_sql` must pass `assertReadOnly`, and the target data source must be visible to the
  caller (own-org) so an alert can't be pointed at another tenant's DB. Queries filter `deleted_at`
  explicitly (the `for all` write policy also grants SELECT without that filter — same as dashboards).
- MCP tools `list_alerts`/`create_alert`/`toggle_alert`/`delete_alert` (`src/lib/mcp/tools.ts`) — the
  "알림 생성은 Claude(MCP)에서" path. UI: `src/app/app/alerts/` (real list + toggle/delete + create form).

Env: notification needs `RESEND_API_KEY`/`RESEND_FROM_EMAIL` (BFF + Trigger host); evaluation runs on the
Trigger.dev host (`SUPABASE_SERVICE_ROLE_KEY` + `KEK_*`, like the agent). Deploy with `npm run trigger:deploy`.
**AI-native additions (BUILT — the differentiator; migrations `20260702130*`):**
- **Anomaly type** (`type='anomaly'`): threshold-LESS. `metric_sql` returns a time SERIES; pure
  `evaluate.ts::anomalyDecision` (z-score of the latest point vs the trailing baseline; unit-tested) drives
  the SAME `decideTransition` hysteresis. New `alerts.sensitivity` column = the z-score cutoff (default 3).
  The runner branches on `alert.type` (series query + `seriesFromRows`) — everything else is reused.
- **Root-cause "why it fired"**: on a firing edge the runner fans out `trigger/explain-alert.ts`, which
  reuses `runAnalysis` VERBATIM (SUPALENS.md context auto-injected → for a repo-attached source it ties the
  metric move to code/behavior), writes the explanation onto `alert_events.explanation`, and sends the
  ENRICHED email (`email/alert.ts` gained an `explanation` block; plain-template fallback if the agent fails).
  `src/lib/alerts/explain.ts` owns the run; retries OFF on the task (it notifies — a retry would double-send).
- **NL creation**: MCP `create_alert` + `actions.ts::createAlert` accept `type`/`sensitivity`, so
  "일매출이 지난주 평균보다 떨어지면 알려줘" via `/app/ask` creates the right alert (RELATIVE thresholds are
  encoded INTO `metric_sql`, e.g. `select today - last_week_avg` vs 0; anomaly needs no threshold). The
  `/app/alerts` form gained a 임계값/이상탐지 toggle + a `/app/ask` link.
- **Notifications**: the root-cause `alert_events.explanation` renders inline in the `/app/alerts` rows
  for a firing alert; **Slack** incoming-webhook (per-org, owner/admin-only `org_slack_config` — the
  webhook is a posting credential so members can't read it, migration `20260703100000`) sends alongside
  email via `src/lib/notify/slack.ts::notifySlack`, wired into the runner (resolved edge) + `explain-alert`
  (fired edge, with the explanation).

**Deferred:** fully-inline web NL box (needs a Trigger round-trip — the architecture keeps ALL LLM on the
agent host, not Vercel; NL creation already works via `/app/ask`), scheduled-report type, Discord webhooks,
seasonal/EWMA anomaly, per-plan caps.

## Goal monitors ("set a goal, not a threshold")

The default way to create a monitor: the operator types a goal, the analysis agent drafts a DAILY
series + a structured rule, the approval card shows the rule's backtest over 90 days, the operator
approves. Full design: [docs/goal-monitors-plan.md](./docs/goal-monitors-plan.md).

- **Data**: `alerts.goal` + `alerts.condition` jsonb (migration `20260927110005`; `NULL` condition =
  legacy monitor, untouched). Rule schema + pure evaluation/backtest in `src/lib/alerts/condition.ts`
  (anomaly = direction-aware z over a BOUNDED trailing window; relative = % vs trailing average;
  absolute = a number the user gave). The in-progress day is always skipped (`dropInProgress`).
- **One evaluation seam**: `src/lib/alerts/monitor-eval.ts::evaluateMonitorResult` — the runner,
  `testAlert` and the recovery check all go through it. Change evaluation there, nowhere else.
- **Drafting is NOT a new LLM entry point**: `POST /api/agent/analyze {intent:'monitor'}` (member+,
  SQL only, same quota/dedupe) → `analyze` task → `runAnalysis({monitorDraft})`, which adds
  `MONITOR_DRAFT_PROMPT` + the `propose_monitor` tool (allow-list pinned in `lockdown.test.ts`).
  `propose_monitor` (`src/lib/alerts/draft.ts`) reads only the result store; series shape is
  enforced by `goal-series.ts::checkGoalSeries` (one row per day, no missing days, ends at the last
  complete day). Draft → `AnalysisChunk {type:'monitor_draft'}` + `agent_runs.result.monitor_draft`.
- **UI**: `src/app/app/monitors/goal/*` (composer, `DraftCard`, `SeriesBandChart`,
  `ConditionControls`, pure `draft-view.ts`); rule wording shared via `condition-label.ts`
  (`appCondition` namespace). `/app/monitors?draft=<runId>` reopens a draft.
- MCP `create_alert` takes `goal` + `condition` (runs the metric once, returns the backtest). Auto-KPI
  anomaly alerts apply as goal conditions (`KpiAlertConfig.direction`).
- Local: `/dev/monitors?mode=goal` (fixture), `scripts/goal-draft-local.ts` (real LLM vs the demo DB).

## Billing (Paddle subscriptions + metered quotas)

Monetization spine: flat tiered subscriptions via **Paddle Billing** (Merchant of Record) + the app
meters queries/tokens per cycle and enforces plan quotas. Paddle Billing has **NO native usage
metering** (its "metered billing" marketing page describes Classic-only Subscription Modifiers that
don't exist in Billing), so "metered" here = app-enforced quotas, NOT Paddle-billed overage. Full
design + decisions: [docs/paddle-billing-plan.md](./docs/paddle-billing-plan.md).

**Plan model — TypeScript is the SSOT.** `src/lib/plans/limits.ts` = `PLAN_LIMITS` (free / basic $89 /
standard $299 / premium $899 — LIVE repricing 2026-07-13) + helpers; `-1` = unlimited. `usage.ts` = `checkUsageQuota` (metered
pre-run gate; lazy free-plan period reset; **fails OPEN** if billing columns are unmigrated so a
deploy-before-migration never hard-blocks) + `incrementUsage` + `enforceResourceLimit`/`enforceSeatLimit`.
`summary.ts` = `getBillingSummary` (billing page).

**Data model** (`supabase/migrations/2026070311*` — applied to remote 2026-07-03): `plan_tier` enum (its
own migration); `organizations` gains `plan`, `subscription_status`, `paddle_customer_id/subscription_id`,
`current_period_*` (metered counters + window), `scheduled_change`. A BEFORE UPDATE **guard trigger**
`app.guard_org_billing_write` blocks the `org_write` policy (owner/admin) from self-escalating those
columns — service_role/postgres only. `paddle_webhook_events` (event_id idempotency; server-only),
`billing_transactions` (member-read history). `increment_org_usage(org_id, query_increment,
token_increment)` is SECURITY DEFINER + atomic (replaced an orphan remote-drift fn of the same name;
`get_plan_team_limit` was dropped — caps live in TS).

**Metering — two seams (do not regress):** the query/token GATE (`checkUsageQuota`) runs at EVERY LLM
entry point — `/api/agent/analyze`, `/api/code/analyze`, MCP `ask` (`src/lib/mcp/tools.ts`), the context
tier-2 generator (`/api/data-sources/[id]/context`), and the GitHub push webhook (`/api/github/webhook`,
per-repo — it SKIPS rather than 402s so GitHub still gets its 200) → HTTP 402 when over budget. **This is
a maintenance invariant: any NEW LLM entry point MUST call `checkUsageQuota`.** It is ALSO the cost-abuse
guard, which works even before Paddle is configured via two billing-INDEPENDENT caps:
`MAX_RUNS_PER_ORG_PER_DAY` (default 200 — counts agent_runs + code_analysis_runs in 24h, inside
`checkUsageQuota`) and `MAX_ORGS_PER_USER` (default 3, at `createOrg` — the daily cap is per-ORG, so
unlimited orgs would multiply a user's budget N×). The INCREMENT happens post-run in `persistRun` (SQL +
Firestore, all transports), `persistCodeRun` (code agent), and `runContextGeneration` (context tier-2),
because the BFF only knows the query — tokens are known only after the run completes. Resource-count caps
(`enforceResourceLimit`) sit at each create point (data source / alert / dashboard / widget / member
invite; `excludeDemo` skips the auto-provisioned demo source); seat cap counts members + pending invites.

**Checkout + provisioning (two interchangeable paths — both are idempotent snapshot UPSERTs over the
same `webhook-handlers.ts` functions, ordering-guarded by `billing_event_at`; running both is safe):**
Client `CheckoutButton` (`@paddle/paddle-js`) → `startCheckout` server action resolves priceId + client
token + org_id; **`org_id` travels in checkout `custom_data`** (the org link on transaction AND
subscription).
1. **API-verified sync (`src/lib/paddle/sync.ts`) — works with NO webhook secret.** On
   `checkout.completed`, the client passes the transaction id to `confirmCheckout` (paddle/actions.ts) —
   the id is only a LOOKUP KEY; the server re-reads the transaction + subscription from the Paddle API
   and provisions from THOSE (never client data). Renewals/cancellations reconcile lazily:
   `reconcileOrgSubscription` runs on the billing page load and inside `checkUsageQuota` when a paid
   org's stored period has lapsed (a genuine period roll resets the counters; canceled → free).
2. **Webhook (`/api/paddle/webhook`) — only when `PADDLE_WEBHOOK_SECRET` is set.** Verifies
   `Paddle-Signature` (HMAC-SHA256 over `ts:rawBody`, RAW body) + `event_id` idempotency; 503s
   without the secret (an unverifiable delivery is never processed).
Self-serve via the Paddle **customer portal** (`openBillingPortal` →
`/customers/{id}/portal-sessions`; mint fresh, never cache). Modules `src/lib/paddle/{config,client,
actions,webhook-handlers,sync}.ts` (NOT `server-only` — shared with the Trigger runtime).
UI: real `/app/settings/billing` (was a mock), and the sidebar's Settings group (`src/components/dashboard/nav.ts`
`SETTINGS_ITEMS` — what un-orphans the Members page). The plan meter is no longer in the sidebar
(`AppChrome.billing` is still loaded by `getAppChrome`).

Env (web server): `PADDLE_API_KEY`,
`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENVIRONMENT`,
`PADDLE_PRICE_ID_{BASIC,STANDARD,PREMIUM}` (+ optional `_YEARLY`); `PADDLE_WEBHOOK_SECRET` is OPTIONAL
(enables the webhook path). The Trigger host needs nothing new (usage increment reuses
`SUPABASE_SERVICE_ROLE_KEY`). **Enforcement is gated on Paddle being configured** (`billingActive()` =
`PADDLE_API_KEY`): with the key unset, `checkUsageQuota` / `enforceResourceLimit` / `enforceSeatLimit`
are NO-OPS (everyone unlimited, checkout hidden) — because capping a user who has no way to upgrade
would strand them. Caps + checkout flip on together the moment the key is set, so the code can ship to
prod before the Paddle dashboard is ready. Set up Products/Prices + client token + API key in the
Paddle dashboard (webhook destination optional); KakaoPay/NaverPay recurring are available for the KR
market.

## Payment proxy gateway (hosted edition only)

Lets partner sites sell recurring subscriptions through the hosted service's Paddle account:
X-API-Key in, `X-Signature: sha256=HMAC(api_secret, rawBody)` callbacks out. Checkout stamps
`custom_data {proxy:1, partner_code, …}` on the Paddle transaction, so every later event
self-identifies and the single `/api/paddle/webhook` route branches on `isProxyCustomData`.
Code: `src/lib/proxy/*`, `/api/proxy/*`, the hosted checkout page `/proxy/checkout`,
`trigger/cloud/proxy-callbacks.ts` (callback retry sweep), `scripts/proxy-partner.ts` (partner
ops CLI). Partner credentials live in the database (`proxy_*` tables, service-role only). The
middleware 404s all of it on a self-hosted install.

## Demo Dataset (try-before-connect sample)

A single shared, read-only e-commerce sample DB auto-attached to every org so users can try the product
before connecting their own database. It reuses the ENTIRE query/agent/viz/picker path via one seam and
is env-gated (off unless `DEMO_DATABASE_URL` is set).

- **Provisioning:** `src/lib/data-sources/demo.ts::ensureDemoSource(orgId)` — idempotent + env-gated;
  inserts ONE `data_sources` row with `is_demo=true` (migration `20260703150000`). Called from `/app/ask`
  (`page.tsx`) on load, so every org gets a "데모 · 이커머스 샘플" source automatically (real sources sort first).
- **The one seam:** `src/lib/query/dsn.ts::resolveDataSource` branches on `is_demo` — creds come from the
  `DEMO_DATABASE_URL` host env (a DEDICATED throwaway Postgres, NOT the per-tenant vault; no SSRF re-pin
  since it's a trusted env host). Everything downstream (SELECT guard, timeouts, row caps, agent, widgets,
  dashboards, MCP) is unchanged.
- **Quota:** demo runs are EXCLUDED from the monthly query quota (`persistRun` skips the increment when
  `is_demo`) and the connection cap (`enforceResourceLimit({excludeDemo:true})`), but ARE still counted by
  the daily abuse cap (`MAX_RUNS_PER_ORG_PER_DAY`) so the demo can't be a free unbounded LLM path.
- **Seed:** `demo/seed.sql` — run it on a DEDICATED throwaway DB (Neon free tier / a separate Supabase
  project, NEVER the app DB), create the read-only role, and use ITS URL as `DEMO_DATABASE_URL`.

Env: `DEMO_DATABASE_URL` on BOTH Vercel (provisioning) AND the Trigger.dev host (the demo query executes
wherever the agent runs). No migration beyond `is_demo`.

## Auto-KPI (repo-driven KPI extraction + one-shot setup)

Analyzes a connected repo+schema and proposes a validated KPI catalog; one click applies it as a
pinned dashboard + alerts. Design + UX journey: [docs/auto-kpi-plan.md](./docs/auto-kpi-plan.md).

- **Accuracy is structural**: the model must run `execute_sql` FIRST (guarded engine → queryId), then
  `propose_kpi({queryId, …})` — the SQL is bound from the stashed result, so nothing unrunnable can
  enter the catalog. `propose_kpi` is registered in `src/lib/agent/tools.ts` ONLY when a `KpiSink` is
  passed (reads only the in-process result Map — the subprocess lockdown is unchanged); the validation
  core is pure + unit-tested (`src/lib/kpi/propose.ts`). Both runners thread it (`RunAnalysisArgs.kpiSink`
  / `RunCodeAnalysisArgs.kpiSink`); allow-lists extend only when the sink is set.
- **Two tiers** (same split as SUPALENS.md context): tier-1 schema-only via `runAnalysis`, tier-2
  repo-attached via `runCodeAnalysis` (code×DB — funnels from real `track()` calls, domain-named
  custom KPIs). `trigger/extract-kpis.ts` mirrors `generate-context` (host-minted installation token,
  global no-retry, `incrementUsage` exactly once post-run, `failExtraction` on every fault path so an
  extraction never sticks at 'running'). Template menu (22, Korean titles) + tier prompts:
  `src/lib/kpi/{templates,prompt}.ts`.
- **Data**: `kpi_catalog` + `kpi_extractions` (`supabase/migrations/20260706090000`) — member-read RLS,
  service_role writes, and a guard trigger locking every kpi_catalog column except `status`/`applied`
  for authenticated (the review UI accepts/dismisses; it can never rewrite SQL/spec/evidence). Access
  goes through the untyped `createAdminClient()` (`src/lib/kpi/service.ts` — Trigger-shared, NOT
  `server-only`). Upserts key on `(data_source_id, key)` and preserve dismissed/accepted statuses.
- **Apply** (`src/lib/kpi/apply.ts` — cookie-free, shared by the route AND MCP): per item revalidate via
  `buildWidgetSpec` (extracted to `src/lib/dashboards/build-widget.ts`, now shared with MCP) →
  saved_query (+ `source` provenance jsonb) + dashboard widget + optional alert (replicates
  `createAlert`'s validation incl. `assertReadOnly`) → `markApplied`. Idempotent pinned dashboard
  (slug `core-kpi`, name "핵심 KPI"); plan caps (`dashboards`/`widgets_per_dashboard`/`alerts_per_org`)
  reported per item — applied items land even when others hit caps.
- **Entry points & quota (the LLM entry-point invariant)**: `POST /api/data-sources/[id]/kpis/extract`
  and MCP `extract_kpis` both call `checkUsageQuota` → 402; firestore (v1 SQL-only) and demo sources
  are rejected; 409 while an extraction is running (<15min). Read/manage: `GET`/`PATCH …/kpis`,
  `POST …/kpis/apply`, MCP `list_kpis`/`apply_kpis`. The GitHub push webhook marks proposals `stale`
  (free — deliberately BEFORE the quota gate, it runs no LLM).
- **UI**: `/app/sources` ◆ KPI chip (추출 → 생성 중…(5s polling) → 제안 N개 → 오래됨) → review page
  `/app/sources/[id]/kpis` (importance≥4 pre-checked + 추천 badge, evidence chips, WidgetRenderer
  previews off the persisted `sample` — zero live queries on load, master 알림 포함 toggle, per-item
  apply report with billing link on cap failures) → pinned "핵심 KPI" dashboard. The /app/ask
  onboarding checklist gained a "핵심 KPI 자동 추출" step. Demo sources auto-seed a canned 10-KPI
  catalog (`src/lib/kpi/demo-catalog.ts`, zero LLM, wired into `ensureDemoSource`).

Deploy: apply the migration (then `db:types`), and `npm run trigger:deploy` — the new `extract-kpis`
task is inert until the Trigger host is redeployed. No new env vars on either runtime.

## Slack Integration (alerts + `@supalens` mention → metrics)

Connect a user's **Slack workspace** to (1) deliver alert notifications to Slack and (2) answer
`@supalens …` mentions with live metrics — embedding the analysis agent in the team's work messenger.
Mirrors the Supabase/GitHub connect flow + the Trigger.dev agent topology. Full design +
build state: [docs/slack.md](./docs/slack.md).

**The reused brain**: a Slack mention is just a new **transport** into the SAME read-only analysis
agent (`runAnalysis`/`runFirestoreAnalysis`), exactly as MCP and the BFF are — no new agent, no
sandbox change.

**Auth model — workspace = org trust (v1)**: a Slack user is NOT a supalens user; anyone who can
`@supalens` in a workspace that installed the bot gets answers scoped to that org (Slack channel
membership = the org's access control, like Metabase's bot). Hardening path (Phase 4, no rewrite):
`notification_channels` enables an allowed-channels scope; per-user account-linking is deferred.

Data model (migration `supabase/migrations/20260708100000_slack_integration.sql`): `provider_kind +=
'slack'` (workspace = a `provider_connections` row, Slack `team_id` in `external_account_id`);
`secret_kind += 'slack_bot_token'` (bot token → **vault**, parent = connection, never a column);
`notification_channels` (provider-NEUTRAL alert routing — `slack|teams|email|webhook`); `slack_events`
(inbound Events API `event_id` idempotency; service_role only; in `prune.ts` RETENTION).

Modules (all **NOT `server-only`** — shared with the Trigger runtime):
- `src/lib/slack-app/*` — `config` (env + `slackConfigured()`), `client` (`exchangeCode`,
  `chatPostMessage`, `listConversations`, `reactionsAdd`, **`verifySlackSignature`** v0 HMAC),
  `connect`/`disconnect`, `token` (`botTokenForConnection` — reveals from vault at call time only).
- `src/lib/messenger/*` — provider-neutral `ReplyRef`/`MessengerAnswerPayload`, `resolveSlackWorkspace`,
  `resolveDefaultDataSource` (mirrors MCP `resolveDataSourceId`), `stripMentions`.
- `src/lib/notify/{slack,dispatch}.ts` — `dispatch.ts::notifyChannels` is THE alert seam: bot channels
  (`chat.postMessage`) + legacy `org_slack_config` webhook fallback. Call sites (`alerts/runner.ts`,
  `alerts/explain.ts`) are provider-agnostic — Teams/Discord = a branch here, not there.
- `trigger/messenger-answer.ts` — Trigger task: engine dispatch → run → `persistRun` (meters usage;
  demo excluded) → post the answer back. Retries OFF (posts to Slack; a retry double-posts).
- Routes: `/api/connect-slack/{authorize,callback}` (state CSRF); **`/api/slack/events`** (@mention:
  raw-body sig verify → `event_id` idempotency → org resolve → allowlist → `checkUsageQuota` →
  `createAgentRun` → 200; quota/no-source = SKIP-and-inform, never a non-200 that invites retries);
  **`/api/slack/commands`** (`/supalens` slash command: replies via the invocation `response_url`, so
  no bot-in-channel needed). Run creation is shared: `src/lib/agent/create-run.ts::createAgentRun`
  (dedupe → insert → trigger) + engine dispatch `agent/engine.ts::taskIdForEngine` (SDK-free, BFF/MCP)
  / `agent/run-by-engine.ts::runByEngine` (in-process, SSE + messenger-answer).
- Mention scoping (Phase 4): owner/admin allowlist in the connection's non-secret
  `metadata.allowed_channel_ids` (empty = any channel); enforced via `messenger/answer.ts::isChannelAllowed`.
- UI: Slack card + `SlackChannelScope` (allowlist) in `/app/settings/integrations`; Slack 봇 채널 picker +
  webhook fallback in `/app/alerts`.

Security invariants (same as the SQL agent): one run = one tenant (`orgId`/`dataSourceId` from the
verified `team_id`, bound in the payload — never chosen by the model or the mention text); the bot
token lives only on the host at call time (vault reveal in the closure), never in a payload/model
context/subprocess; `/api/slack/events` is a NEW LLM entry point → `checkUsageQuota` (the maintenance
invariant); inbound webhook = RAW-body HMAC + `event_id` idempotency (mirrors Paddle/GitHub).

Env (BFF only — the Trigger host reads the bot token from the vault, no new host secret):
`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (+ optional `SLACK_REDIRECT_URI`).
Unset → the connect UI/routes are inert (`slackConfigured()` = false). Register the App at
api.slack.com (bot scopes `app_mentions:read`/`chat:write`/`channels:read`/`groups:read`; subscribe
`app_mention`; Events request URL `<origin>/api/slack/events`; slash command `/supalens` → request URL
`<origin>/api/slack/commands`). Deploy the task with `npm run trigger:deploy` (the `messenger-answer`
task is inert until the Trigger host is redeployed).

## Internationalization (i18n — en default, ko, ja)

English is the primary language; Korean + Japanese secondary. Built on **next-intl** in three phases
(all BUILT): P1 landing, P2 `/app`, P3 server/LLM/SEO. Full design + status:
[docs/i18n-plan.md](./docs/i18n-plan.md).

**Routing — HYBRID (the key decision):** marketing is path-routed under `src/app/[locale]/` (`/` = en,
`/ko`, `/ja`) for SEO; `/app` is NOT path-routed — it resolves locale from the `NEXT_LOCALE` cookie.
Both share ONE resolver: `src/i18n/request.ts` uses the `[locale]` segment when present, else the cookie.
`localePrefix: 'as-needed'` (`src/i18n/routing.ts`). **The single root `layout.tsx` renders `<html lang=
{await getLocale()}>`** — do NOT render `<html>` in `[locale]/layout.tsx` (nested `<html>` is invalid;
moving it there strips `/app`,`/api`,`/auth`,`/dev`,`/test`,`/share` of html+providers). `[locale]/layout`
is a pass-through (`setRequestLocale` + `generateStaticParams` for SSG).

**Middleware (the #1 fragility):** `src/middleware.ts` chains next-intl's middleware (marketing paths
only, gated by `INTL_PATH`) with Supabase — `applySupabaseSession(req, response)` LAYERS auth cookies
onto the intl response rather than recreating it (recreating drops the intl rewrite). Keep `/app`,`/api`,
`/auth`,`/dev`,`/test`,`/share`,`/logos`,`/login`,`.well-known` OUT of `INTL_PATH`.

**Message catalogs** `messages/{en,ko,ja}.json` — ~50 namespaces: landing (`nav`,`hero`,…), `app*` (one
per `/app` area), `email*` (one per email). ko = source of truth, en = canonical default, **ja = machine
draft (needs a native pass)**. Fragments live in the session scratchpad; a merge produced the catalogs.

**Three translation buckets (do NOT conflate):** (1) UI strings → catalogs, read via
`useTranslations`/`getTranslations`. (2) LLM-facing → NOT translated: prompt scaffolding stays English;
`src/lib/i18n/agent-locale.ts::languageDirective(locale)` appends only a "respond in {lang}" section to
all three runners' system prompts. (3) Server/cron strings (emails) → recipient's STORED locale
(`profiles.locale`), rendered request-free via `src/lib/i18n/server-translator.ts::getServerTranslator`
(next-intl `createTranslator` + **static** JSON imports so esbuild bundles them on the Trigger host —
NOT a dynamic `import(`messages/${l}.json`)`). Keep English: enums, API fields, logs, MCP tool names, SQL.

**Locale sources by path:** marketing = URL segment; `/app` = `NEXT_LOCALE` cookie (set by the app
`LanguageSwitcher` variant + persisted to `profiles.locale` via `setUserLocale`); cron/email =
`resolve-locale.ts` (`resolveUserLocale`/`resolveOrgLocale` — best-effort, degrades to `en`). Agent-run
locale is threaded through the BFF (`getLocale`), SSE route, MCP `ask`, and the trigger payloads.

**Adding UI text:** put the string in the right `messages/*.json` namespace and read it with
`t('key')` — never hardcode Korean (that was the pre-i18n convention; it's now a regression). New email/
cron text → add to an `email*` namespace + `getServerTranslator`. `profiles.locale` migration
(`20260708033606`) must be pushed + `db:types` re-run for the stored-locale paths to activate (they
degrade to `en` until then). No new env vars; `npm run trigger:deploy` to ship the localized email/agent
paths to the Trigger host.

## Tracked links and signup attribution

`GET /r/<code>[?to=/path]` (`src/app/r/[code]/route.ts` — public, top-level) logs a click to
`outreach_clicks`, sets a first-touch `sl_ref` HttpOnly cookie when the code belongs to a live
row in `outreach_campaigns`, and 302s to the app (`to` is internal-path-only → no open redirect).
`ensurePrimaryOrg` (a new user's first workspace) and `createOrg` then credit the signup in
`outreach_campaign_conversions` (unique per org and per user = first touch). Module:
`src/lib/attribution/{logic,service}.ts` (`service.ts` is `server-only`; every function is
best-effort and never throws). The `outreach_leads` tables in the migrations belong to a staff
tool that is not part of this repository.

**content-agent tracking** (hosted edition; a complete no-op unless `CONTENT_AGENT_TRACKING_URL`
and `_TOKEN` are set): `/r/<code>` stores a strict-UUID `ca_variant` in the first-touch `sl_cav`
cookie; org creation turns it into a `content_agent_attribution` row and enqueues `signup`;
`src/lib/content-agent/events.ts` writes final event JSON to `content_agent_outbox` (event_id
unique); `trigger/cloud/content-agent-outbox.ts` delivers it via `sweep.ts` (200 = delivered,
400/413 bisect and park, 401/403/404 park and stop, 429/5xx back off). Pure policy in `logic.ts` /
`delivery.ts` (pin-tested).

## Business X-ray (/x — public, no-signup repo reports)

The viral top of the funnel: paste a PUBLIC GitHub repo → a few minutes later a shareable report
at `/x/<owner>/<repo>` (how the product makes money, "metric traps" where two parts of the code count
the same number differently, KPIs worth watching, a grade). Its CTA is "Connect Supabase read-only".
Built on the public-demo pattern (anonymous LLM entry, fail-closed gates, run-scoped Realtime token).

- **Data** — `xray_reports` (`supabase/migrations/20260924100000`): one row per scan of one commit in
  one locale; also the cache (succeeded row for the same owner/repo/commit/locale) and the rate-limit
  ledger (`ip_hash`/`cookie_id`). service_role only (RLS on, no policies); a partial unique index allows
  ONE in-flight scan per repo+locale (a second visitor joins it). Untyped admin client (no `db:types` need).
- **Agent** — `trigger/cloud/xray.ts` reuses `runCodeAnalysis` VERBATIM (same lockdown) with four small generic
  hooks added for it: optional `token` (anonymous public clone), `systemPrompt`, `extraServers` (tool
  servers built over the clone dir) and `onCloned`. X-ray tools (`src/lib/xray/tools.ts`): `note` (live
  discoveries) + `submit_xray`. **Accuracy is structural**: the model only points at code (path +
  line range); `verifySubmission` copies the real lines from the clone, redacts secrets
  (`redact.ts` — reports are public pages), rejects ranges that don't exist / escape the jail / name a
  secret file. Score/grade are computed (`schema.ts::scoreFor/gradeFor`: 100 − 10 per certain trap − 3
  per needs-data trap), never chosen by the model. Prompt: `prompt.ts`.
- **BFF** — `POST /api/xray` (parse → GitHub metadata via `github.ts` (public, size cap, HEAD sha) →
  cache → join in-flight → "already X-rayed" offer unless `rescan` → per-visitor / global daily /
  in-flight caps (`config.ts`, all fail CLOSED) → insert → trigger → public token). `GET /api/xray/[id]`
  = status poll + fresh run-scoped token. **X-ray has no org, so `checkUsageQuota` cannot apply — its
  own global daily budget (`XRAY_MAX_SCANS_PER_DAY`) is the cost ceiling.** Any new path that starts a
  scan must go through these gates.
- **UI** — `src/app/[locale]/x/` (landing + `XrayForm`), `x/[owner]/[repo]/` (page picks scan / report /
  empty; `ScanView` = Realtime stream `xray` + 4s poll, stage logic pure in `lib/xray/events.ts`;
  `ReportView`; the share card = `src/app/x-card/[owner]/[repo]/route.ts` — outside `[locale]` so og:image has no
  `/en` redirect, `?v=<reportId>` pins a version and is cached long, the "not yet" card is `no-store`). Report pages are
  `noindex` (third-party repos on request); owners ask to hide via email (`hidden_at`). Dev preview
  with a fixture: `/dev/xray` (`?view=report|scan|failed&n=`). Local end-to-end without DB/Trigger:
  `npx tsx --env-file=.env.local scripts/xray-local.ts <owner/repo>` (needs `git` + `rg` on PATH).
- **Deploy** — apply the migration, `npm run trigger:deploy` (new `xray-scan` task; the build now
  apt-installs `git` + `ripgrep`). Optional env: `XRAY_GITHUB_TOKEN` (no-scope token, 5k/h GitHub API
  instead of 60/h), `XRAY_SCANS_PER_VISITOR_PER_DAY` (3), `XRAY_MAX_SCANS_PER_DAY` (60),
  `XRAY_MAX_INFLIGHT` (4), `XRAY_MAX_REPO_KB` (250000).

## Error Tracking (Sentry)

Two SEPARATE Sentry setups, one per runtime — they are different processes and each needs its own `Sentry.init`:

- **Vercel (Next.js)** — `@sentry/nextjs`. `src/instrumentation.ts` (`register()`, calls `Sentry.init` for
  the `nodejs`/`edge` runtimes + exports `onRequestError`) and `src/instrumentation-client.ts` (browser
  init) — this is the CURRENT required pattern for `@sentry/nextjs` v9+; do not add
  `sentry.server.config.ts`/`sentry.client.config.ts`, they're deprecated and the plugin will warn.
  `next.config.ts` is wrapped in `withSentryConfig` (source map upload; a no-op without
  `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN`). Error boundaries: `src/app/global-error.tsx` (root
  layout crashes) and `src/app/app/error.tsx` (the product surface — the one users will actually hit).
- **Trigger.dev** — `@sentry/node` (NOT `@sentry/nextjs` — see below), initialized in `trigger/sentry.ts`
  alongside a global `tasks.onFailure` hook that reports every task failure. Side-effect-import this file
  (`import './sentry'`) at the top of every task file (`analyze.ts`, `evaluate-alerts.ts`) rather than
  relying on Trigger's directory-bundling order to pick up a bare hook file.

**Critical constraint — do NOT add Sentry inside the Claude Agent SDK subprocess** (`run-analysis.ts` /
`run-code-analysis.ts`): that subprocess has its env stripped to `PATH`/`HOME`/`ANTHROPIC_API_KEY` and
disallows network-capable tools by design (see "AI Analysis Agent" above) — adding an SDK with network
egress there would violate the lockdown. Errors from inside it are already captured by the orchestrating
Trigger.dev task that spawns it.

**Files shared between the Vercel and Trigger.dev runtimes must NOT `import 'server-only'`** — Trigger's
bundler (plain Node/esbuild) doesn't alias it to a no-op the way Next.js's webpack does, so it throws at
import time in a real deploy (this bit `src/lib/alerts/runner.ts` + `src/lib/email/{alert,resend}.ts`
during initial alerts work; fixed — see the comment convention already established in
`src/utils/supabase/admin.ts`). Such shared files use `@sentry/node` rather than `@sentry/nextjs` for the
same reason (both share the same `@sentry/core` client, so whichever process's `Sentry.init` ran —
`instrumentation.ts` or `trigger/sentry.ts` — receives the event). Before adding `'server-only'` to any
new `src/lib/**` module, check whether `trigger/*.ts` transitively imports it.

**Instrumentation is additive, not a control-flow change**: existing `console.error`/`console.warn` sites
keep their log line; `Sentry.captureException`/`captureMessage` is added alongside. The email modules'
"never throw" contract (see `lib/email/invite.ts`) is unchanged — Sentry visibility does not turn a
degrade-gracefully failure into a thrown one. Expected/user-caused failures (e.g. a bad DB password during
data-source registration) are deliberately NOT sent to Sentry — only genuine system faults are, to avoid
alert fatigue.

Env: `SENTRY_DSN` (server + Trigger.dev) / `NEXT_PUBLIC_SENTRY_DSN` (browser) — same DSN value is fine,
DSNs aren't secret. Unset → `Sentry.init` runs with `enabled: false`, a deliberate no-op (same "degrade,
don't crash" contract used everywhere else in this repo).

## E2E Testing

E2E 테스트 가이드는 [E2E.md](./E2E.md)를 참고하세요.

주요 명령어:
- `npm run test:e2e` - E2E 테스트 실행
- `npm run test:e2e:ui` - UI 모드로 실행
