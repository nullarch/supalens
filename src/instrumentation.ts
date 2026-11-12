import * as Sentry from '@sentry/nextjs'

/**
 * Next.js instrumentation hook — runs once per server/edge runtime boot, before
 * any route code. This (not sentry.server.config.ts / sentry.edge.config.ts) is
 * where Sentry.init MUST live for current @sentry/nextjs versions.
 *
 * NEVER import this from the sandboxed Claude Agent SDK subprocess (run-analysis.ts
 * / run-code-analysis.ts) — that subprocess has its env stripped to
 * PATH/HOME/ANTHROPIC_API_KEY and disallows network-capable tools by design
 * (see CLAUDE.md "AI Analysis Agent"). Errors from INSIDE that subprocess are
 * already captured by the orchestrating Trigger.dev task that spawns it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      // silent no-op (not an error) when SENTRY_DSN is unset — same "degrade,
      // don't crash" contract as the email modules.
      enabled: Boolean(process.env.SENTRY_DSN),
    })

    // Self-hosted default: background work (agents, monitor checks, digests) runs in THIS process
    // instead of on Trigger.dev. Start its scheduler once per server boot. The marker value keeps
    // every "is a task worker configured?" check in the routes true; nothing ever sends it anywhere.
    if (process.env.NEXT_PUBLIC_SUPALENS_TASK_BACKEND === 'builtin') {
      process.env.TRIGGER_SECRET_KEY ||= 'builtin'
      const { startScheduler } = await import('./lib/tasks/builtin/scheduler')
      void startScheduler()
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      enabled: Boolean(process.env.SENTRY_DSN),
    })
  }
}

export const onRequestError = Sentry.captureRequestError
