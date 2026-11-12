// NOT `import 'server-only'` — shared helpers for the /api/proxy/* route handlers.
import type { SupabaseClient } from '@supabase/supabase-js'

import type { ProxyPartner } from './auth'

export interface SubscriptionRow {
  id: string
  partner_id: string
  partner_user_id: string
  partner_order_id: string | null
  customer_email: string | null
  status: string
  paddle_subscription_id: string | null
  paddle_customer_id: string | null
  paddle_checkout_txn_id: string | null
  current_period_starts_at: string | null
  current_period_ends_at: string | null
  scheduled_change: Record<string, unknown> | null
  canceled_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  proxy_products: { sku: string } | { sku: string }[] | null
}

/** Load a subscription SCOPED to the authed partner — a foreign id behaves like a missing one (404). */
export async function loadPartnerSubscription(
  admin: SupabaseClient,
  partner: ProxyPartner,
  id: string,
): Promise<SubscriptionRow | null> {
  const { data } = await admin
    .from('proxy_subscriptions')
    .select(
      'id, partner_id, partner_user_id, partner_order_id, customer_email, status, paddle_subscription_id, paddle_customer_id, paddle_checkout_txn_id, current_period_starts_at, current_period_ends_at, scheduled_change, canceled_at, metadata, created_at, proxy_products (sku)',
    )
    .eq('id', id)
    .eq('partner_id', partner.id)
    .limit(1)
  return (data?.[0] as unknown as SubscriptionRow | undefined) ?? null
}

export interface TransactionRow {
  id: string
  paddle_transaction_id: string
  kind: string
  status: string
  amount_cents: number | null
  currency: string | null
  billing_period_starts_at: string | null
  billing_period_ends_at: string | null
  billed_at: string | null
}

export async function latestTransactionOf(admin: SupabaseClient, subscriptionId: string): Promise<TransactionRow | null> {
  const { data } = await admin
    .from('proxy_transactions')
    .select('id, paddle_transaction_id, kind, status, amount_cents, currency, billing_period_starts_at, billing_period_ends_at, billed_at')
    .eq('subscription_id', subscriptionId)
    .order('created_at', { ascending: false })
    .limit(1)
  return (data?.[0] as TransactionRow | undefined) ?? null
}

/** The partner-facing subscription shape (pull API + docs contract). */
export function serializeSubscription(row: SubscriptionRow, latestTxn: TransactionRow | null): Record<string, unknown> {
  const product = Array.isArray(row.proxy_products) ? row.proxy_products[0] : row.proxy_products
  return {
    subscription_id: row.id,
    partner_order_id: row.partner_order_id,
    partner_user_id: row.partner_user_id,
    sku: product?.sku ?? null,
    status: row.status,
    current_period_starts_at: row.current_period_starts_at,
    current_period_ends_at: row.current_period_ends_at,
    scheduled_change: row.scheduled_change,
    canceled_at: row.canceled_at,
    customer_email: row.customer_email,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    latest_transaction: latestTxn
      ? {
          transaction_id: latestTxn.id,
          paddle_transaction_id: latestTxn.paddle_transaction_id,
          kind: latestTxn.kind,
          status: latestTxn.status,
          amount_cents: latestTxn.amount_cents,
          currency: latestTxn.currency,
          billing_period_starts_at: latestTxn.billing_period_starts_at,
          billing_period_ends_at: latestTxn.billing_period_ends_at,
          billed_at: latestTxn.billed_at,
        }
      : null,
  }
}
