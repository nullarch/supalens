'use server'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { isPlanTier } from '@/lib/plans/limits'
import { priceIdFor, adminTestPriceId, getPaddleClientConfig, isPaddleConfigured, type BillingInterval, type PaddleEnv } from './config'
import { createPortalSession } from './client'
import { syncCheckoutTransaction } from './sync'

export interface CheckoutParams {
  priceId: string
  email: string | null
  orgId: string
  clientToken: string
  environment: PaddleEnv
}

/**
 * Resolve everything the browser needs to open a Paddle checkout for a paid plan.
 * The org_id travels in checkout custom_data → flows back on the provisioning webhook.
 * Errors are stable CODES (not display strings) — the client localizes them
 * (see components/billing/error-label.ts), keeping server actions locale-free.
 */
export async function startCheckout(
  plan: string,
  interval: BillingInterval = 'month',
): Promise<{ ok: true; data: CheckoutParams } | { ok: false; error: string }> {
  const isAdminTest = plan === 'admin_test'
  if (!isAdminTest && (!isPlanTier(plan) || plan === 'free')) return { ok: false, error: 'invalid_plan' }
  // Never open a checkout we can't provision: confirmCheckout/reconcile need the server API key,
  // so without it a completed payment would grant nothing. Refuse up front instead.
  if (!isPaddleConfigured()) return { ok: false, error: 'not_configured' }
  const priceId = isAdminTest ? adminTestPriceId() : priceIdFor(plan, interval)
  if (!priceId) return { ok: false, error: 'price_not_configured' }
  const { token, environment } = getPaddleClientConfig()
  if (!token) return { ok: false, error: 'not_configured' }

  const supabase = await createClient()
  if (!supabase) return { ok: false, error: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  // The $1 internal price is staff-only — gate SERVER-side on profiles.is_admin (the plan
  // string is client-supplied, so without this check anyone could subscribe for $1).
  if (isAdminTest) {
    const admin = requireAdminClient()
    const { data } = await admin.from('profiles').select('is_admin').eq('id', user.id).limit(1)
    if ((data?.[0] as { is_admin?: boolean } | undefined)?.is_admin !== true) {
      return { ok: false, error: 'forbidden' }
    }
  }

  const orgId = await ensurePrimaryOrg(supabase, user)

  return { ok: true, data: { priceId, email: user.email ?? null, orgId, clientToken: token, environment } }
}

/**
 * Called by the client right after Paddle.js fires `checkout.completed`, with the overlay's
 * transaction id. NOT trusted input — syncCheckoutTransaction re-reads the transaction and
 * subscription from the Paddle API and provisions from those, so this can only materialize
 * Paddle's own records (auth required so it isn't an anonymous lookup oracle), and the
 * checkout's custom_data org must be one the CALLER belongs to (membership re-check inside
 * the sync — custom_data itself is client-set). This is the PRIMARY provisioning path when
 * PADDLE_WEBHOOK_SECRET isn't configured, and a harmless idempotent duplicate when the
 * webhook also fires.
 */
export async function confirmCheckout(transactionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^txn_[a-zA-Z0-9]+$/.test(transactionId)) return { ok: false, error: 'invalid_transaction_id' }
  const supabase = await createClient()
  if (!supabase) return { ok: false, error: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }
  try {
    return await syncCheckoutTransaction(transactionId, { requireMembershipOfUserId: user.id })
  } catch {
    return { ok: false, error: 'sync_failed' }
  }
}

/**
 * Mint a Paddle customer-portal URL (self-serve manage / cancel / update payment).
 * owner/admin only — billing management is a privileged action.
 */
export async function openBillingPortal(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, error: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }
  const orgId = await ensurePrimaryOrg(supabase, user)

  const { data: mem } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .limit(1)
  const role = (mem?.[0] as { role: string } | undefined)?.role
  if (role !== 'owner' && role !== 'admin') return { ok: false, error: 'forbidden' }

  const admin = requireAdminClient()
  const { data: orgRows } = await admin
    .from('organizations')
    .select('paddle_customer_id, paddle_subscription_id')
    .eq('id', orgId)
    .limit(1)
  const org = orgRows?.[0] as { paddle_customer_id: string | null; paddle_subscription_id: string | null } | undefined
  if (!org?.paddle_customer_id) return { ok: false, error: 'no_billing_profile' }

  try {
    const urls = await createPortalSession(
      org.paddle_customer_id,
      org.paddle_subscription_id ? [org.paddle_subscription_id] : undefined,
    )
    if (!urls.overview) return { ok: false, error: 'portal_url_missing' }
    return { ok: true, url: urls.overview }
  } catch {
    return { ok: false, error: 'portal_failed' }
  }
}
