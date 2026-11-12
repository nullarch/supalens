// PostHog product-analytics wrapper — the funnel/retention layer next to the GA event wrapper
// (see analytics.ts). Env-gated: with NEXT_PUBLIC_POSTHOG_KEY unset it is a full no-op, so local
// dev / self-host without a PostHog account stays silent (same "degrade, don't crash" contract as
// Sentry/Paddle). Client-only — posthog-js touches window. DSN/host are public (NEXT_PUBLIC_).
import posthog from 'posthog-js'

import { isCloud } from '@/config/edition'

let ready = false

/** Init once on client startup (called from instrumentation-client.ts). Safe to call repeatedly. */
export function initPostHog(): void {
  if (ready || typeof window === 'undefined') return
  // Hosted edition only: a self-hosted install sends no product analytics anywhere.
  const key = isCloud() ? process.env.NEXT_PUBLIC_POSTHOG_KEY : undefined
  if (!key) return
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only', // only create profiles for identified (signed-in) users
    capture_pageview: true,
    autocapture: false, // we fire explicit funnel events instead of DOM autocapture noise
  })
  ready = true
}

/** Capture an event. No-op until init (i.e. when PostHog isn't configured). Never throws. */
export function phCapture(event: string, props?: Record<string, unknown>): void {
  if (!ready) return
  try {
    posthog.capture(event, props)
  } catch {
    /* analytics must never break a user flow */
  }
}

/** Tie subsequent events to a user (called on SIGNED_IN). No-op until init. Never throws. */
export function phIdentify(userId: string, props?: Record<string, unknown>): void {
  if (!ready) return
  try {
    posthog.identify(userId, props)
  } catch {
    /* ignore */
  }
}
