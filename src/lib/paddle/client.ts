// NOT `import 'server-only'` — server-side Paddle REST client (shared convention).
// Backend-only: uses the secret API key. Never import from client components.
import { getPaddleConfig, PADDLE } from './config'

interface PaddleError {
  error?: { code?: string; detail?: string }
}

async function paddleFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const cfg = getPaddleConfig()
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      'Paddle-Version': PADDLE.apiVersion,
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as T & PaddleError
  if (!res.ok) {
    const msg = json?.error?.detail || json?.error?.code || `paddle_api_${res.status}`
    throw new Error(`Paddle API ${path} failed: ${msg}`)
  }
  return json
}

/**
 * Create a one-off usage-overage charge on the customer's saved payment method. GATED — the caller
 * MUST have checked overageEnabled() first; this additionally requires OVERAGE_PADDLE_PRODUCT_ID (the
 * product the ad-hoc overage price hangs off). `automatic` collection bills the customer's default
 * method. Amount is USD. Throws on API error (the webhook caller swallows so it never breaks delivery).
 * NOTE: validate this end-to-end in the Paddle SANDBOX before enabling in production — it moves money.
 */
export async function createOverageCharge(customerId: string, amountUsd: number, description: string): Promise<void> {
  const productId = process.env.OVERAGE_PADDLE_PRODUCT_ID
  if (!productId) throw new Error('OVERAGE_PADDLE_PRODUCT_ID is not set')
  const cents = Math.round(amountUsd * 100)
  if (cents <= 0) return
  await paddleFetch('/transactions', {
    method: 'POST',
    body: {
      customer_id: customerId,
      currency_code: 'USD',
      collection_mode: 'automatic',
      items: [
        {
          quantity: 1,
          price: {
            name: 'Usage overage',
            description,
            product_id: productId,
            tax_mode: 'account_setting',
            unit_price: { amount: String(cents), currency_code: 'USD' },
          },
        },
      ],
    },
  })
}

interface CheckoutTransactionResponse {
  data?: {
    id?: string
    checkout?: { url?: string | null } | null
  }
}

/**
 * Create a checkout transaction for a catalog price and return the hosted checkout
 * URL (the account's default payment link + ?_ptxn=<txn_id>). Used by the proxy
 * gateway: custom_data stamped here is copied by Paddle onto the subscription the
 * checkout creates, and from there onto every transaction it ever bills (renewals,
 * upgrades) — the routing backbone for proxy webhook events.
 */
export async function createCheckoutTransaction(input: {
  priceId: string
  customData: Record<string, unknown>
  customerEmail?: string | null
}): Promise<{ id: string; checkoutUrl: string | null }> {
  const json = await paddleFetch<CheckoutTransactionResponse>('/transactions', {
    method: 'POST',
    body: {
      items: [{ price_id: input.priceId, quantity: 1 }],
      custom_data: input.customData,
      ...(input.customerEmail ? { customer: { email: input.customerEmail } } : {}),
    },
  })
  const id = json.data?.id
  if (!id) throw new Error('Paddle API /transactions returned no transaction id')
  return { id, checkoutUrl: json.data?.checkout?.url ?? null }
}

/**
 * Cancel a subscription. 'next_billing_period' schedules the cancel (Paddle emits
 * subscription.updated with scheduled_change now, subscription.canceled at period
 * end); 'immediately' emits subscription.canceled right away.
 */
export async function cancelSubscription(
  subscriptionId: string,
  effectiveFrom: 'next_billing_period' | 'immediately',
): Promise<void> {
  await paddleFetch(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: { effective_from: effectiveFrom },
  })
}

interface EntityResponse {
  data?: Record<string, unknown>
}

/** Fetch a transaction by id — the read side of the API-verified checkout sync (paddle/sync.ts). */
export async function getTransaction(transactionId: string): Promise<Record<string, unknown> | null> {
  const json = await paddleFetch<EntityResponse>(`/transactions/${transactionId}`)
  return json.data ?? null
}

/** Fetch a subscription by id — renewal/cancel reconcile without webhooks (paddle/sync.ts). */
export async function getSubscription(subscriptionId: string): Promise<Record<string, unknown> | null> {
  const json = await paddleFetch<EntityResponse>(`/subscriptions/${subscriptionId}`)
  return json.data ?? null
}

/**
 * List a customer's subscriptions — reconcile's self-heal scan for a paid-but-unlinked org
 * (paddle/sync.ts). Filtered server-side by customer, so the result set is tiny.
 */
export async function listSubscriptionsByCustomer(customerId: string): Promise<Array<Record<string, unknown>>> {
  const json = await paddleFetch<{ data?: Array<Record<string, unknown>> }>(
    `/subscriptions?customer_id=${encodeURIComponent(customerId)}&per_page=200`,
  )
  return json.data ?? []
}

interface PortalSessionResponse {
  data?: {
    urls?: {
      general?: { overview?: string }
      subscriptions?: Array<{
        id?: string
        cancel_subscription?: string
        update_subscription_payment_method?: string
      }>
    }
  }
}

export interface PortalUrls {
  overview: string
  cancel?: string
  updatePayment?: string
}

/**
 * Create a customer-portal session — short-lived, auto-sign-in URLs for self-serve
 * manage / cancel / update-payment. Mint fresh per click; never cache.
 */
export async function createPortalSession(customerId: string, subscriptionIds?: string[]): Promise<PortalUrls> {
  const json = await paddleFetch<PortalSessionResponse>(`/customers/${customerId}/portal-sessions`, {
    method: 'POST',
    body: subscriptionIds?.length ? { subscription_ids: subscriptionIds } : {},
  })
  const urls = json.data?.urls
  const sub = urls?.subscriptions?.[0]
  return {
    overview: urls?.general?.overview ?? '',
    cancel: sub?.cancel_subscription,
    updatePayment: sub?.update_subscription_payment_method,
  }
}
