# MCP Server — Implementation Plan

supalens exposes **one hosted MCP server** so an AI client (Claude Code, Cursor, …) running
**in the user's own repo** can read their connected database and turn KPIs it finds in the
code into shared, live supalens dashboards. Marketing contract: `McpHub.tsx` (`mcp.supalens.ai`,
one server / every client, OAuth 2.1 **or** `sl_` key, `execute_sql` = SELECT-only).

## Why this beats a raw Postgres/Supabase MCP

The web analysis agent (Trigger.dev) only sees the DB — it is **repo-blind**. In-repo Claude
Code is the only place that fuses **code knowledge** (what to measure, how it's computed) with
**governed data access**. Three durable advantages, and the design is aligned to make each real:

1. **Zero-credential, governed read.** DB creds stay in the supalens vault; the dev's machine
   holds only an org-scoped key. SELECT-only guard + READ ONLY tx + statement_timeout + row cap
   + audit are inherited from `src/lib/query` — safe to point an autonomous agent at prod.
2. **Bi-directional durability.** A query/chart/dashboard authored from Claude Code becomes a
   shared artifact in the web app (same `VisualizationSpec` contract), not an ephemeral chat.
3. **Delegated reasoning (v1.1).** `ask` offloads heavy NL→SQL→chart to the Trigger.dev agent.

The headline flow — *"find our server KPIs and put them in supalens"*: Claude Code reads the
repo → derives the KPI SQL → `get_schema` reconciles against the **real** prod schema →
`execute_sql` sanity-checks → `create_dashboard` persists. Idempotent by slug → re-runnable as
the codebase evolves.

## Architecture

- **Transport:** remote **Streamable HTTP**, stateless (no Redis, SSE disabled). A Next.js
  route handler — no separate service. `src/app/api/mcp/[transport]/route.ts` via `mcp-handler`
  (`createMcpHandler` + `withMcpAuth`). `runtime = 'nodejs'` (uses `pg` + vault + KMS).
  Connect URL `<origin>/api/mcp/mcp`; prod rewrites `mcp.supalens.ai/mcp` → here.
- **Auth:** two tracks, both → the same `{orgId, apiKeyId, createdBy}` (`AuthInfo.extra`, read in
  every tool via `extra.authInfo.extra`), so tool code never branches on auth kind:
  - `Authorization: Bearer sl_…` (long-lived key) → `verifyApiKey` → `api_keys` (sha256).
  - `Authorization: Bearer slat_…` (OAuth 2.1 access token) → `verifyAccessToken`. **OAuth is
    implemented** (`src/lib/mcp/oauth.ts` + `/api/oauth/*` + `/.well-known/*`): DCR → authorize
    (consent over the Supabase session) → token (PKCE S256), refresh-token rotation, tokens stored
    in `api_keys` (`mcp_access_token`/`mcp_refresh_token`). The MCP 401 advertises
    `/.well-known/oauth-protected-resource` so key-less clients auto-start the flow.
- **Reuse, don't rebuild.** Read → `src/lib/query` (`executeReadOnly`/`getSchema`/`assertReadOnly`).
  Viz/persist → `src/lib/viz/spec.ts` (`VisualizationSpec`/`ChartSpec`/`referencedColumns`) +
  `dashboards`/`saved_queries`/`dashboard_widgets`. Auth/audit → `api_keys`/`Actor`/`audit_log`
  (`actor_kind='mcp_token'`). The MCP server is a **new transport over existing layers**.
- **All DB access via the service-role admin client, manually scoped by `org_id`** (the bearer
  key is not a Supabase JWT, so RLS can't apply via user context — same model as the agent).

### Why stateless changes the queryId pattern
The agent's in-process tools bridge `execute_sql → propose_visualization` via an in-memory
`queryId` map. A stateless HTTP server can't share that across requests, so the **write tools
take `sql` directly** and re-run + validate it server-side (cheap, read-only) — same validation
(`referencedColumns` + `VisualizationSpec.safeParse`), no cross-request state.

## Tool surface (11 shipped)

| Tier | Tool | Backing |
|---|---|---|
| Orient | `get_setup_status`, `list_data_sources` | admin / org scope |
| Read | `get_schema`, `execute_sql` | `getSchema`, `executeReadOnly` |
| Persist | `register_query`, `create_dashboard`, `add_widget`, `list_dashboards`, `list_widgets` | dashboards tables + `VisualizationSpec` |
| Delegate | `ask`, `get_analysis` | Trigger.dev `analyze` task + `agent_runs` |

- `create_dashboard` accepts inline `widgets[]` (composite, atomic), **validates ALL before any
  write**, **upserts by `(org_id, slug)`**, and **declaratively syncs** widgets (re-run replaces).
- `add_widget` adds one widget to an existing dashboard (id or slug, UUID-checked to avoid
  PostgREST `.or` filter injection).
- **Provenance:** `register_query`/`add_widget`/`create_dashboard` widgets take an optional
  `source` (repo path / git ref) stored in `saved_queries.source` jsonb — so code-derived KPIs
  record where they came from and can be re-derived.
- `ask` queues the analysis agent (returns `runId`); `get_analysis` polls `agent_runs.result`.
  Stateless-safe: writes take `sql` directly (no cross-request queryId map).

## Security invariants (carried from the agent — do not regress)

- **One call = one tenant.** `resolveDataSourceId` authorizes the requested id against the
  token's org; the model can pass any id but only reaches sources the org owns.
- **Creds never leave the server.** Resolved from the vault inside `executeReadOnly`'s closure,
  never returned, never in model context.
- **Read stays read.** `execute_sql`/widget SQL go through the SELECT-only guard + READ ONLY tx
  + timeout + row cap + audit (`actor_kind='mcp_token'`).
- **Writes hit only supalens' own tables** (dashboards/saved_queries/widgets) — never the
  customer DB. `add_data_source` is intentionally NOT a write-creds-over-MCP tool (deep-link only).

## Files

```
src/lib/mcp/keys.ts                     mint / verify / list / revoke sl_ keys (api_keys, sha256)
src/lib/mcp/oauth.ts                    OAuth 2.1 AS: DCR, codes, token issue/verify, PKCE, refresh
src/lib/mcp/auth.ts                     withMcpAuth verifier (sl_ key OR slat_ token) → AuthInfo
src/lib/mcp/tools.ts                    the 11 tools (org-scoped, reuse query+viz+agent layers)
src/app/api/mcp/[transport]/route.ts    Streamable HTTP handler (createMcpHandler + withMcpAuth)
src/app/api/mcp-keys/route.ts           key mgmt (user-session auth): mint / list / revoke
src/app/api/oauth/{register,authorize,token}/route.ts   OAuth endpoints (authorize renders consent)
src/app/.well-known/oauth-{protected-resource,authorization-server}/route.ts   discovery metadata
src/app/app/mcp/{page.tsx,McpClient.tsx} install hub: mint key, copy connect cmd, list/revoke
supabase/migrations/20260630140000_mcp.sql     saved_queries.source (provenance)
supabase/migrations/20260630150000_oauth.sql   oauth_clients, oauth_auth_codes, api_keys.client_id
```

Env: optional `API_KEY_PEPPER` (extra hash pepper), `NEXT_PUBLIC_APP_URL` (connect-URL origin).
Dep note: `@modelcontextprotocol/sdk` pinned to **^1.29.0** (claude-agent-sdk peer); `mcp-handler`
declares an exact 1.26.0 peer but runs fine on 1.29.0 (install used `--legacy-peer-deps`).

## Phasing

- **MVP — DONE:** Streamable HTTP + `sl_` key auth + 9 read/persist tools + install hub. Full
  "find KPIs → dashboard" loop. E2E-verified on local Supabase.
- **v1 — DONE:** OAuth 2.1 PKCE (DCR + authorize/consent + token + refresh rotation + discovery),
  `ask`/`get_analysis` (delegate to the agent), provenance (`saved_queries.source`), prod subdomain
  rewrite. OAuth flow + token→MCP auth E2E-verified (interactive consent page pending live-client test).
- **v1.1 — TODO:** alerts (needs a `alerts` table + a Trigger.dev evaluation/notification runner —
  not just CRUD) + `get_schema` introspection cache + per-token rate limit + per-data-source
  concurrency cap. Prod: push migrations to remote; point `mcp.supalens.ai` DNS at the app.
```
