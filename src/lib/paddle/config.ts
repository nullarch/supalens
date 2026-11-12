// NOT `import 'server-only'` — shared with the Trigger.dev runtime convention
// (see src/utils/supabase/admin.ts). Reads PADDLE_* / NEXT_PUBLIC_PADDLE_* env.
// Paddle price IDs are NOT secret (they appear in the checkout), so exposing them
// via a server action to the browser is fine; the API key is backend-only.
import type { PlanTier } from '@/lib/plans/limits'

export const PADDLE = {
  apiBaseProduction: 'https://api.paddle.com',
  apiBaseSandbox: 'https://sandbox-api.paddle.com',
  apiVersion: '1',
} as const

export type BillingInterval = 'month' | 'year'
export type PaddleEnv = 'sandbox' | 'production'

export interface PaddleServerConfig {
  apiKey: string
  /** Optional — set only when webhook provisioning is used (see paddle/sync.ts for the webhook-less path). */
  webhookSecret: string | null
  environment: PaddleEnv
  apiBase: string
}

function resolveEnv(): PaddleEnv {
  // the public variable also drives the checkout script (NEXT_PUBLIC_PADDLE_ENVIRONMENT)
  return process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT === 'production' ? 'production' : 'sandbox'
}

/**
 * Server-side Paddle config. Requires the API key; the webhook secret is OPTIONAL —
 * without it, provisioning runs through the API-verified checkout sync (paddle/sync.ts)
 * instead of webhooks. Throws if the API key is unset.
 */
export function getPaddleConfig(): PaddleServerConfig {
  const apiKey = process.env.PADDLE_API_KEY
  if (!apiKey) {
    throw new Error('Paddle is not configured. Set PADDLE_API_KEY.')
  }
  const environment = resolveEnv()
  return {
    apiKey,
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET ?? null,
    environment,
    apiBase: environment === 'production' ? PADDLE.apiBaseProduction : PADDLE.apiBaseSandbox,
  }
}

/** Whether Paddle is configured (degrade-gracefully checks). The webhook secret is not required. */
export function isPaddleConfigured(): boolean {
  return Boolean(process.env.PADDLE_API_KEY)
}

/** Client token + env for Paddle.js (browser-safe; statically referenced so Next inlines it). */
export function getPaddleClientConfig(): { token: string | null; environment: PaddleEnv } {
  return {
    token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN ?? null,
    environment: resolveEnv(),
  }
}

// --- price catalog (env-driven; we own the catalog) --------------------------

const PAID_TIERS: PlanTier[] = ['basic', 'standard', 'premium']
const INTERVALS: BillingInterval[] = ['month', 'year']

export function priceIdEnvKey(plan: PlanTier, interval: BillingInterval): string {
  // naming: monthly = PADDLE_PRICE_ID_BASIC, yearly = PADDLE_PRICE_ID_BASIC_YEARLY
  return interval === 'month'
    ? `PADDLE_PRICE_ID_${plan.toUpperCase()}`
    : `PADDLE_PRICE_ID_${plan.toUpperCase()}_YEARLY`
}

/** Forward map for checkout (server-side). */
export function priceIdFor(plan: PlanTier, interval: BillingInterval): string | null {
  return process.env[priceIdEnvKey(plan, interval)] ?? null
}

export interface PlanPrice {
  plan: PlanTier
  interval: BillingInterval
  priceId: string
}

/** All configured paid price IDs (skips any not set in env). */
export function configuredPrices(): PlanPrice[] {
  const out: PlanPrice[] = []
  for (const plan of PAID_TIERS) {
    for (const interval of INTERVALS) {
      const priceId = process.env[priceIdEnvKey(plan, interval)]
      if (priceId) out.push({ plan, interval, priceId })
    }
  }
  return out
}

/**
 * Staff-only $1 test price (PADDLE_PRICE_ID_ADMIN_TEST). Deliberately NOT part of
 * configuredPrices() so it never surfaces in public pricing UI (PlanCards grid /
 * yearly toggle detection) — it is purchasable only through the is_admin-gated
 * startCheckout branch, and provisions premium entitlements (see planForPriceId).
 */
export function adminTestPriceId(): string | null {
  return process.env.PADDLE_PRICE_ID_ADMIN_TEST ?? null
}

/** Reverse map priceId → {plan, interval} — used by the webhook to resolve a subscription's plan. */
export function planForPriceId(priceId: string): { plan: PlanTier; interval: BillingInterval } | null {
  for (const p of configuredPrices()) {
    if (p.priceId === priceId) return { plan: p.plan, interval: p.interval }
  }
  // the $1 staff subscription entitles the org as premium (internal/dogfooding orgs
  // shouldn't run into free caps while paying the test price)
  const adminTest = adminTestPriceId()
  if (adminTest && priceId === adminTest) return { plan: 'premium', interval: 'month' }
  return null
}
