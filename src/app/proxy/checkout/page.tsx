import { notFound, redirect } from 'next/navigation'

import { createAdminClient } from '@/utils/supabase/admin'
import { getPaddleClientConfig } from '@/lib/paddle/config'
import { ProxyCheckoutClient } from './checkout-client'

export const dynamic = 'force-dynamic'

export { generateMetadata } from './checkout-metadata'

const LIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'paused'])

function appendParams(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

/**
 * Hosted checkout page for the proxy gateway (the account's default payment link).
 * Reads ?_ptxn= (the same parameter Paddle checkout links use), resolves the pending
 * proxy subscription, and opens the Paddle checkout for that transaction. The redirect
 * back to the partner is a UX signal only — fulfillment always comes from the webhook
 * relay / pull API, never from this page.
 */
export default async function ProxyCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ _ptxn?: string }>
}) {
  const { _ptxn } = await searchParams
  if (!_ptxn) notFound()

  const admin = createAdminClient()
  if (!admin) notFound()

  const { data } = await admin
    .from('proxy_subscriptions')
    .select('id, status, customer_email, success_url, fail_url, partner_id, proxy_partners(name), proxy_products(sku)')
    .eq('paddle_checkout_txn_id', _ptxn)
    .limit(1)
  const row = data?.[0] as
    | {
        id: string
        status: string
        customer_email: string | null
        success_url: string
        fail_url: string
        proxy_partners: { name: string } | { name: string }[] | null
        proxy_products: { sku: string } | { sku: string }[] | null
      }
    | undefined
  if (!row) notFound()

  // Revisits after settlement: bounce straight back to the partner.
  if (LIVE_STATUSES.has(row.status)) {
    redirect(appendParams(row.success_url, { subscription_id: row.id, status: 'success' }))
  }
  if (row.status !== 'pending') {
    redirect(appendParams(row.fail_url, { subscription_id: row.id, status: 'failed', reason: row.status }))
  }

  const { token, environment } = getPaddleClientConfig()
  if (!token) notFound()

  const partner = Array.isArray(row.proxy_partners) ? row.proxy_partners[0] : row.proxy_partners

  return (
    <ProxyCheckoutClient
      transactionId={_ptxn}
      partnerName={partner?.name ?? ''}
      customerEmail={row.customer_email}
      successUrl={appendParams(row.success_url, { subscription_id: row.id, status: 'success' })}
      failUrl={appendParams(row.fail_url, { subscription_id: row.id, status: 'canceled' })}
      clientToken={token}
      environment={environment}
    />
  )
}
