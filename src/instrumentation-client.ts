import * as Sentry from '@sentry/nextjs'

import { initPostHog } from '@/utils/posthog'

/**
 * Browser-side Sentry init. Next.js loads this automatically (App Router
 * convention — see the webpack/turbopack plugin in @sentry/nextjs); do not
 * import it manually. `NEXT_PUBLIC_SENTRY_DSN` is the browser-safe DSN
 * (Sentry DSNs are not secret — safe to ship in the client bundle — but we
 * still gate on it being set so local dev without a Sentry account stays
 * silent instead of erroring).
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
})

// Product analytics (funnel/retention) — env-gated no-op without NEXT_PUBLIC_POSTHOG_KEY.
initPostHog()

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
