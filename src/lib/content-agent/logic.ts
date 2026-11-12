// PURE — no io, no env, no framework imports (pin-tested in logic.test.ts). Shared by the /r
// capture route, the org-creation attribution, the event recorders (Vercel + Trigger.dev) — so it
// must never grow a `server-only` or Next.js import.
import { createHmac } from 'node:crypto'

import { minorToMajor } from '@/lib/paddle/money'

// ── ca_variant capture (first-touch cookie) ────────────────────────────────────────────────────

/** First-touch content-agent attribution cookie: the saved-variant id a visitor arrived through. */
export const CA_VARIANT_COOKIE = 'sl_cav'
export const CA_VARIANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days, same window as sl_ref

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A strict UUID (any version), lowercased — anything else is junk and returns null. */
export function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return UUID_RE.test(v) ? v.toLowerCase() : null
}

export interface VariantCapture {
  variantId: string
  campaignId: string | null
  /** ISO timestamp, second precision (the cookie stores epoch seconds). */
  capturedAt: string
}

function secondPrecision(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 1000) * 1000)
}

/**
 * Read `ca_variant` (+ optional `utm_id` → campaign) off a tracked-link request. content-agent's
 * links append utm_source/utm_medium/utm_campaign/utm_content/ca_service/ca_variant (+ utm_id for
 * campaigns); only the two UUIDs matter to us. No valid ca_variant → null (nothing to capture); a
 * junk utm_id is simply dropped.
 */
export function captureFromSearchParams(params: URLSearchParams, now: Date = new Date()): VariantCapture | null {
  const variantId = normalizeUuid(params.get('ca_variant'))
  if (!variantId) return null
  return {
    variantId,
    campaignId: normalizeUuid(params.get('utm_id')),
    capturedAt: secondPrecision(now).toISOString(),
  }
}

/** Cookie-safe (no encoding needed) compact form: `v1.<variantId>.<campaignId|''>.<epochSeconds>`. */
export function encodeVariantCookie(capture: VariantCapture): string {
  const secs = Math.floor(new Date(capture.capturedAt).getTime() / 1000)
  return `v1.${capture.variantId}.${capture.campaignId ?? ''}.${secs}`
}

/** Strict inverse of encodeVariantCookie — any deviation (tampering, old format) → null. */
export function decodeVariantCookie(raw: string | null | undefined): VariantCapture | null {
  if (typeof raw !== 'string' || raw.length > 120) return null
  const parts = raw.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') return null
  const variantId = normalizeUuid(parts[1])
  if (!variantId) return null
  let campaignId: string | null = null
  if (parts[2] !== '') {
    campaignId = normalizeUuid(parts[2])
    if (!campaignId) return null
  }
  if (!/^\d{9,11}$/.test(parts[3])) return null
  return { variantId, campaignId, capturedAt: new Date(Number(parts[3]) * 1000).toISOString() }
}

// ── business events (the tracking contract) ────────────────────────────────────────────────────

/** Names content-agent's revenue report reads `value` from (refunds are subtracted by name). */
export const REVENUE_EVENT_NAMES: ReadonlySet<string> = new Set(['purchase', 'subscription_payment', 'refund'])

const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/
const ANON_ID_RE = /^[0-9a-f-]{16,128}$/i
const CURRENCY_RE = /^[A-Z]{3}$/
const MAX_EVENT_ID_LENGTH = 200

/** One event exactly as POSTed — unavailable optional fields are OMITTED, never null. */
export interface ContentAgentEvent {
  eventId: string
  name: string
  occurredAt: string
  variantId?: string
  campaignId?: string
  anonymousId?: string
  value?: number
  currency?: string
}

export interface EventInput {
  eventId: string
  name: string
  occurredAt: string | Date
  variantId?: string | null
  campaignId?: string | null
  anonymousId?: string | null
  value?: number | null
  currency?: string | null
}

/**
 * Validate + normalize an event for the outbox. Required fields invalid → null (the caller logs
 * and skips — never a malformed row the ingress would 400 on). occurredAt is re-serialized as UTC
 * ISO (always carries a timezone). Optional fields that fail validation are dropped; value and
 * currency travel together or not at all (a bare amount would be meaningless to the report).
 */
export function buildEvent(input: EventInput): ContentAgentEvent | null {
  const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : ''
  if (!eventId || eventId.length > MAX_EVENT_ID_LENGTH) return null
  if (typeof input.name !== 'string' || !EVENT_NAME_RE.test(input.name)) return null
  const at = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt)
  if (Number.isNaN(at.getTime())) return null

  const event: ContentAgentEvent = { eventId, name: input.name, occurredAt: at.toISOString() }
  const variantId = normalizeUuid(input.variantId)
  if (variantId) event.variantId = variantId
  const campaignId = normalizeUuid(input.campaignId)
  if (campaignId) event.campaignId = campaignId
  if (typeof input.anonymousId === 'string' && ANON_ID_RE.test(input.anonymousId)) {
    event.anonymousId = input.anonymousId.toLowerCase()
  }
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : ''
  if (typeof input.value === 'number' && Number.isFinite(input.value) && input.value >= 0 && CURRENCY_RE.test(currency)) {
    event.value = input.value
    event.currency = currency
  }
  return event
}

/**
 * Stable, non-reversible per-org anonymousId: HMAC-SHA256 over a domain-separated org id, 64 hex
 * chars (the contract allows 16–128 hex/hyphen). Never an email/IP/user id — the org UUID itself
 * never leaves supalens.
 */
export function anonymousIdForOrg(orgId: string, key: string): string {
  return createHmac('sha256', key).update(`content-agent:org:${orgId}`).digest('hex')
}

// ── Paddle → event field mapping ───────────────────────────────────────────────────────────────

/** Mirrors lib/proxy/webhook-handlers.ts::isProxyCustomData (kept local so this module stays pure). */
function isProxyCustomData(customData: unknown): boolean {
  return Boolean(
    customData && typeof (customData as { proxy_subscription_id?: unknown }).proxy_subscription_id === 'string',
  )
}

/** Paddle minor-unit string/number → decimal major units (zero-decimal currencies stay whole). */
export function minorAmountToMajor(raw: string | number | null | undefined, currency: string | null | undefined): number | null {
  if (raw == null || !currency) return null
  const minor = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(minor)) return null
  return Number(minorToMajor(minor, currency).toFixed(2))
}

/** The Paddle transaction fields the mapping reads (structural — see PaddleTransactionData). */
export interface PaddleTransactionLike {
  id: string
  status: string
  currency_code?: string | null
  details?: { totals?: { grand_total?: string | null } | null } | null
  billed_at?: string | null
  custom_data?: unknown
}

/** The Paddle adjustment fields the mapping reads (structural — see PaddleAdjustmentData). */
export interface PaddleAdjustmentLike {
  id: string
  action?: string | null
  status?: string | null
  transaction_id?: string | null
  currency_code?: string | null
  totals?: { total?: string | null; currency_code?: string | null } | null
  created_at?: string | null
  updated_at?: string | null
}

export type MappedEventFields = Pick<EventInput, 'eventId' | 'name' | 'occurredAt' | 'value' | 'currency'>

const SETTLED_TXN = new Set(['completed', 'paid'])

/**
 * A settled org-subscription transaction → `subscription_payment`. The eventId is the Paddle
 * transaction id, so the webhook and the API-verified sync (which both record the same
 * transaction, possibly first as 'paid' then 'completed') collapse to one event. Proxy-gateway
 * (partner) transactions and $0 transactions (trial starts, fully-credited changes) are not
 * supalens revenue → null.
 */
export function paymentEventFromTransaction(txn: PaddleTransactionLike, now: Date = new Date()): MappedEventFields | null {
  if (!txn?.id || !SETTLED_TXN.has(txn.status)) return null
  if (isProxyCustomData(txn.custom_data)) return null
  const value = minorAmountToMajor(txn.details?.totals?.grand_total, txn.currency_code)
  if (value == null || value <= 0) return null
  return {
    eventId: `subscription_payment:${txn.id}`,
    name: 'subscription_payment',
    occurredAt: txn.billed_at ?? now.toISOString(),
    value,
    currency: txn.currency_code!.toUpperCase(),
  }
}

/**
 * An APPROVED refund or chargeback adjustment → `refund` (both reverse collected revenue, and the
 * report subtracts by name). eventId = the adjustment id, so partial refunds on one transaction are
 * distinct events. The amount is the adjustment's own total (never the transaction's — a partial
 * refund must not subtract the full payment); missing → the event is still sent, without value.
 */
export function refundEventFromAdjustment(
  adj: PaddleAdjustmentLike,
  fallbackCurrency: string | null | undefined,
  now: Date = new Date(),
): MappedEventFields | null {
  if (!adj?.id || !adj.transaction_id) return null
  const refundLike = adj.action === 'refund' || adj.action === 'chargeback'
  const approved = adj.status == null || adj.status === 'approved'
  if (!refundLike || !approved) return null
  const currency = adj.totals?.currency_code ?? adj.currency_code ?? fallbackCurrency ?? null
  const raw = adj.totals?.total
  const minor = raw != null ? Number(raw) : Number.NaN
  const value = currency && Number.isInteger(minor) ? minorAmountToMajor(Math.abs(minor), currency) : null
  return {
    eventId: `refund:${adj.id}`,
    name: 'refund',
    occurredAt: adj.updated_at ?? adj.created_at ?? now.toISOString(),
    value,
    currency: value != null && currency ? currency.toUpperCase() : null,
  }
}
