// Server-side product-analytics emitter — the funnel half that the browser cannot see.
//
// The activation funnel crosses the network boundary: a user leaves for Supabase/GitHub/Slack
// and comes back to a REDIRECT, so `supabase_connected` / `github_connected` / `repo_attached`
// only ever exist server-side. The browser wrapper (utils/analytics.ts) covers everything that
// happens on a page; this covers everything that happens in a route handler or server action.
//
// Contract, in order of importance:
//   1. NEVER throws and never blocks the response. PostHog being slow or down must not delay an
//      OAuth redirect, and an analytics fault must not turn a successful connect into an error.
//   2. Env-gated. With NEXT_PUBLIC_POSTHOG_KEY unset it is a full no-op (same "degrade, don't
//      crash" contract as Sentry/Paddle/Resend).
//   3. Same `distinct_id` as the browser (the Supabase auth user id — see provider.tsx's
//      identify call), so a server event and a client event land on ONE person in the funnel.
//
// NOT `import 'server-only'`: this module reads `after` from next/server, so it is Next-only by
// construction and is never reachable from the Trigger.dev bundle. Keep it that way — if a
// Trigger task ever needs to emit, give it its own awaited emitter instead of importing this.
import { after } from 'next/server'

import { isCloud } from '@/config/edition'

const CAPTURE_PATH = '/capture/'
const TIMEOUT_MS = 3_000

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>

function config(): { key: string; host: string } | null {
  // Hosted edition only: a self-hosted install sends no product analytics anywhere.
  const key = isCloud() ? process.env.NEXT_PUBLIC_POSTHOG_KEY : undefined
  if (!key) return null
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '')
  return { key, host }
}

/** Drop undefined/null so PostHog properties stay clean (an absent source_id is not "null"). */
function clean(props?: AnalyticsProps): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v !== undefined && v !== null) out[k] = v
  }
  return out
}

async function send(cfg: { key: string; host: string }, body: unknown): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    await fetch(`${cfg.host}${CAPTURE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch {
    /* analytics must never break a user flow — a dropped event is the correct failure mode */
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Capture one server-side event.
 *
 * Scheduled with `after()` so it runs AFTER the response is flushed — on Vercel a bare floating
 * promise can be frozen when the function returns, which would silently drop most events. Outside
 * a request scope (a unit test, a script) `after` throws; we fall back to a caught floating promise.
 *
 * @param distinctId the Supabase auth user id when known, else an `org:<id>` fallback so an
 *                   anonymous-ish server event still attributes to the workspace.
 */
export function trackServer(event: string, distinctId: string, props?: AnalyticsProps): void {
  const cfg = config()
  if (!cfg || !event || !distinctId) return
  const body = {
    api_key: cfg.key,
    event,
    distinct_id: distinctId,
    properties: { ...clean(props), $lib: 'supalens-server' },
    timestamp: new Date().toISOString(),
  }
  try {
    after(() => send(cfg, body))
  } catch {
    void send(cfg, body)
  }
}

/** `trackServer` with the workspace as the identity — for events with no acting user. */
export function trackServerOrg(event: string, orgId: string, props?: AnalyticsProps): void {
  trackServer(event, `org:${orgId}`, { org_id: orgId, ...props })
}
