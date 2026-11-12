import * as Sentry from '@sentry/node'
import { tasks } from '@trigger.dev/sdk'

/**
 * Sentry for the Trigger.dev runtime — a SEPARATE process/deploy from the
 * Next.js server, so it needs its own Sentry.init (the app's src/instrumentation.ts
 * only covers the Vercel side). Side-effect import this file (`import
 * './sentry'`) at the top of every task file so init + the global onFailure
 * hook are registered regardless of Trigger's directory-bundling order.
 *
 * Do NOT import @sentry/node from src/lib/agent/run-analysis.ts's Claude Agent
 * SDK subprocess — that subprocess has its env stripped to
 * PATH/HOME/ANTHROPIC_API_KEY and network-capable tools disallowed by design
 * (see CLAUDE.md). This file only instruments the orchestrating task, which
 * spawns that subprocess and already has full network access.
 */
// With the built-in task backend these modules load inside the web server, which has already
// initialised Sentry (src/instrumentation.ts) — a second init would replace that client.
if (process.env.NEXT_PUBLIC_SUPALENS_TASK_BACKEND !== 'builtin') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    enabled: Boolean(process.env.SENTRY_DSN),
  })
}

tasks.onFailure(({ task, payload, error }) => {
  Sentry.captureException(error, { tags: { trigger_task: task }, extra: { payload } })
})
