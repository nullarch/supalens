// Product-analytics wrapper. Fans out to BOTH Google Analytics (@next/third-parties/google) and
// PostHog (posthog.ts) — GA for marketing/traffic, PostHog for the product funnel/retention. Each
// side no-ops when its key isn't configured, and never throws. Call from client components only.
import { sendGAEvent } from '@next/third-parties/google'

import { phCapture, phIdentify } from './posthog'

export function track(event: string, params?: Record<string, string | number | boolean>): void {
  try {
    sendGAEvent('event', event, params ?? {})
  } catch {
    /* GA not ready / not configured — analytics must never break a user flow */
  }
  phCapture(event, params)
}

/** Tie the current + future events to a signed-in user (PostHog). No-op if PostHog isn't configured. */
export function identify(userId: string, props?: Record<string, string | number | boolean>): void {
  phIdentify(userId, props)
}
