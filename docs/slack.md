# Slack Integration

Connect a user's **Slack workspace** so supalens can (1) deliver alert notifications to Slack and
(2) answer `@supalens …` mentions with live metrics — embedding the analysis agent directly in the
team's work messenger. Deliberately mirrors the Supabase/GitHub connect flow and the Trigger.dev
agent topology.

## Three concerns, one seam

| Concern | Direction | Status |
|---|---|---|
| Alert notifications → Slack | outbound | **built** — bot channel (Phase 3) + legacy webhook fallback |
| `@supalens` mention → metric answer | inbound (interactive) | **built (Phase 2)** |
| Provider-neutral routing (Teams/Discord later) | — | schema + code seams in place |

The reusable brain is the SAME read-only analysis agent as the web/MCP paths. A Slack mention is
just a new **transport** into `runAnalysis` / `runFirestoreAnalysis`, exactly as MCP and the BFF are.

## Auth model — workspace = org trust (v1)

A Slack user is NOT a supalens-authenticated user. v1 uses **workspace = org trust**: anyone who can
`@supalens` in a workspace that installed the bot gets answers scoped to that org's data. Rationale:
this feature's value is zero-friction team adoption; Slack channel membership is the org's existing
access control (this is how Metabase's Slack bot and most BI bots work). Hardening path without a
rewrite: `notification_channels` already exists, so an "allowed channels only" toggle (Phase 4) scopes
the blast radius; per-user account linking is deferred to a regulated-customer ask.

## Data model (`supabase/migrations/20260708100000_slack_integration.sql`)

- `provider_kind += 'slack'`; the workspace is a `provider_connections` row (`provider='slack'`,
  Slack `team_id` in the existing `external_account_id`, one live per `(org, provider, team_id)`).
- `secret_kind += 'slack_bot_token'`; the bot token → **vault** (parent = connection), never a column.
- `notification_channels` — provider-NEUTRAL alert routing (`provider in slack|teams|email|webhook`,
  `target`, `connection_id`, `config jsonb`). Owner/admin RLS. Wired via `notify/dispatch.ts`.
- `slack_events` — inbound Events API `event_id` idempotency (Slack retries until 200). service_role
  only; registered in `maintenance/prune.ts` RETENTION (90d).

## Modules

- `src/lib/slack-app/*` (NOT `server-only` — shared with the Trigger runtime):
  `config` (env + OAuth URLs + scopes + `slackConfigured()`), `client` (`exchangeCode`,
  `chatPostMessage`, `reactionsAdd`, **`verifySlackSignature`** v0 HMAC), `connect` (code → connection
  → vault), `disconnect` (auth.revoke + vault revoke + soft-delete, §4), `token` (`botTokenForConnection`
  reveals from the vault — token lives only at call time).
- `src/lib/messenger/*` — provider-neutral: `ReplyRef`/`MessengerAnswerPayload`, `resolveSlackWorkspace`,
  `resolveDefaultDataSource` (mirrors MCP `resolveDataSourceId`), `stripMentions`.
- `src/lib/notify/{slack,dispatch}.ts` — `slack.ts` = primitives + `formatAlertText`; `dispatch.ts` =
  THE alert seam `notifyChannels(orgId, args)`: fans out to `notification_channels` (bot channels via
  `chat.postMessage`) with the legacy `org_slack_config` webhook as fallback. Call sites (alerts
  `runner.ts` / `explain.ts`) are provider-agnostic — Teams/Discord = a new branch here, not there.
- `trigger/messenger-answer.ts` — Trigger task: engine dispatch → `runAnalysis`/`runFirestoreAnalysis`
  → `persistRun` (meters usage; demo excluded) → post the answer back. Retries OFF (posts to Slack).
- Routes: `/api/connect-slack/{authorize,callback}` (state CSRF), **`/api/slack/events`** (@mention;
  raw-body sig verify → `event_id` idempotency → org resolve → allowlist → `checkUsageQuota` →
  `createAgentRun` → 200; SKIP-and-inform on quota/no-source), **`/api/slack/commands`** (`/supalens`
  slash command; replies via `response_url`). Shared run creation: `agent/create-run.ts`.
- UI: Slack card + `SlackChannelScope` allowlist in `/app/settings/integrations`; "미설정" when env unset.

## Security invariants (same as the SQL agent)

- One run = one tenant: `orgId`/`dataSourceId` resolved from the verified `team_id`, bound in the
  payload — never chosen by the model or the Slack text.
- The bot token lives only on the host at call time (vault reveal in the route/task closure), never in
  the payload, model context, or subprocess.
- `/api/slack/events` is a NEW LLM entry point → gates on `checkUsageQuota` (the maintenance invariant).
- Inbound webhook: RAW-body HMAC verify + `event_id` idempotency (mirrors Paddle/GitHub).

## Env (BFF only — the Trigger host reads the bot token from the vault, no new host secret)

`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (+ optional `SLACK_REDIRECT_URI`).
Unset → the connect UI/routes are inert (`slackConfigured()` = false).

## Deploy / registration

1. Register the App at api.slack.com/apps. **OAuth & Permissions** bot scopes: `app_mentions:read`,
   `chat:write`, `channels:read`, `groups:read`. **Redirect URL**: `<origin>/api/connect-slack/callback`.
2. Apply the migration (`db:push` + `db:types`).
3. `npx trigger.dev@<pinned> deploy` — the `messenger-answer` task is inert until the Trigger host is
   redeployed (a mention would otherwise silently never answer).
4. Set `SLACK_*` on Vercel; deploy.
5. In the App's **Event Subscriptions**: Request URL `<origin>/api/slack/events` (Slack does the
   url_verification handshake), subscribe to bot event `app_mention`. Reinstall the app to the workspace.

## Alert channel UI (Phase 3)

`/app/alerts` shows a **Slack 봇 채널** picker (populated from `conversations.list` — the bot must be
invited to the channel to post) when a workspace is connected; `setAlertSlackChannel` upserts the
`notification_channels` row. The legacy webhook input remains as a labeled fallback.

## Slash command + channel scoping (Phase 4 — BUILT)

- **`/supalens <question>`** (`/api/slack/commands`): works anywhere (incl. DMs) without the bot
  being in the channel — the answer is delivered via the per-invocation `response_url` (no bot token
  needed for that path; `ReplyRef` gained a `slack_response_url` variant). Same v0 signature verify +
  quota gate; acks with an ephemeral "분석 중…" within 3s, the task posts the real answer async.
- **Mention allowlist**: owner/admin can scope which channels the bot answers in, stored in the
  connection's non-secret `metadata.allowed_channel_ids` (empty = any channel, the default trust
  model). Enforced in the events + commands routes via `isChannelAllowed`; managed by
  `SlackChannelScope` on `/app/settings/integrations` (`setSlackAllowedChannelsAction`).
- **Shared run-creation**: `src/lib/agent/create-run.ts::createAgentRun` (double-submit guard →
  insert `agent_runs` → trigger) is reused by the web BFF, events, and commands routes; engine
  dispatch is centralized in `src/lib/agent/engine.ts` (`taskIdForEngine`, SDK-free) +
  `run-by-engine.ts` (`runByEngine`, in-process).

Register the slash command in the Slack app dashboard → Slash Commands → `/supalens`, Request URL
`<origin>/api/slack/commands`.

## Deferred (Phase 5+)

Chart-image uploads (widget → PNG); App Home tab; Teams/Discord adapters (reuse `messenger/*` +
`notification_channels` + a new `dispatch.ts` branch); multi-channel alert routing (per-alert channel).
