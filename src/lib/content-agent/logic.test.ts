import { describe, expect, it } from 'vitest'

import { isProxyCustomData } from '@/lib/proxy/webhook-handlers'
import {
  anonymousIdForOrg,
  buildEvent,
  captureFromSearchParams,
  decodeVariantCookie,
  encodeVariantCookie,
  minorAmountToMajor,
  normalizeUuid,
  paymentEventFromTransaction,
  refundEventFromAdjustment,
} from './logic'

/**
 * Pins for the content-agent pure layer:
 * - ca_variant capture is strict-UUID only (junk never reaches the cookie / DB)
 * - the sl_cav cookie round-trips and rejects tampering
 * - events omit unavailable optional fields, always carry a timezone, value+currency travel together
 * - anonymousId is stable, contract-shaped, and never contains the raw org id
 * - Paddle mapping: minor→major (zero-decimal KRW), proxy + $0 excluded, refund amount = adjustment's own
 */

const VARIANT = '0f8e2a4c-1b2d-4e5f-8a9b-0c1d2e3f4a5b'
const CAMPAIGN = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'

describe('normalizeUuid', () => {
  it('accepts a UUID (any case, trimmed) and lowercases it', () => {
    expect(normalizeUuid(` ${VARIANT.toUpperCase()} `)).toBe(VARIANT)
  })
  it('rejects junk', () => {
    for (const junk of ['', 'abc', `${VARIANT}x`, `${VARIANT.slice(0, -1)}`, "'; drop table x;--", null, undefined, 42]) {
      expect(normalizeUuid(junk)).toBeNull()
    }
  })
})

describe('captureFromSearchParams', () => {
  const now = new Date('2026-09-25T05:12:01.987Z')
  it('captures ca_variant + utm_id at second precision', () => {
    const params = new URLSearchParams({
      to: '/x',
      utm_source: 'x',
      utm_medium: 'social',
      utm_campaign: 'silent-failure',
      utm_content: 'post-1',
      ca_service: 'supalens',
      ca_variant: VARIANT,
      utm_id: CAMPAIGN,
    })
    expect(captureFromSearchParams(params, now)).toEqual({
      variantId: VARIANT,
      campaignId: CAMPAIGN,
      capturedAt: '2026-09-25T05:12:01.000Z',
    })
  })
  it('drops a junk utm_id but keeps the variant', () => {
    const params = new URLSearchParams({ ca_variant: VARIANT, utm_id: 'spring-launch' })
    expect(captureFromSearchParams(params, now)?.campaignId).toBeNull()
  })
  it('captures nothing without a valid ca_variant', () => {
    expect(captureFromSearchParams(new URLSearchParams({ utm_id: CAMPAIGN }), now)).toBeNull()
    expect(captureFromSearchParams(new URLSearchParams({ ca_variant: 'not-a-uuid' }), now)).toBeNull()
  })
})

describe('sl_cav cookie', () => {
  it('round-trips with and without a campaign', () => {
    const withCampaign = { variantId: VARIANT, campaignId: CAMPAIGN, capturedAt: '2026-09-25T05:12:01.000Z' }
    const without = { ...withCampaign, campaignId: null }
    expect(decodeVariantCookie(encodeVariantCookie(withCampaign))).toEqual(withCampaign)
    expect(decodeVariantCookie(encodeVariantCookie(without))).toEqual(without)
    // cookie-safe without encoding
    expect(encodeVariantCookie(withCampaign)).toMatch(/^[a-z0-9.-]+$/)
  })
  it('rejects tampered / foreign values', () => {
    const good = encodeVariantCookie({ variantId: VARIANT, campaignId: null, capturedAt: '2026-09-25T05:12:01.000Z' })
    for (const bad of [
      undefined,
      null,
      '',
      good.replace('v1.', 'v2.'),
      good.replace(VARIANT, 'nope'),
      `${good}.extra`,
      good.replace(/\.\d+$/, '.soon'),
      `v1.${VARIANT}.junk.1790000000`,
      'x'.repeat(200),
    ]) {
      expect(decodeVariantCookie(bad)).toBeNull()
    }
  })
})

describe('buildEvent', () => {
  it('omits unavailable optional fields (never null) and serializes occurredAt as UTC ISO', () => {
    const event = buildEvent({ eventId: 'signup:org-1', name: 'signup', occurredAt: '2026-09-25T14:00:00+09:00' })
    expect(event).toEqual({ eventId: 'signup:org-1', name: 'signup', occurredAt: '2026-09-25T05:00:00.000Z' })
    expect(Object.values(event!)).not.toContain(null)
  })
  it('carries attribution, anonymousId and value+currency when valid', () => {
    const anon = anonymousIdForOrg('org-1', 'k')
    expect(
      buildEvent({
        eventId: 'subscription_payment:txn_1',
        name: 'subscription_payment',
        occurredAt: new Date('2026-09-25T00:00:00Z'),
        variantId: VARIANT.toUpperCase(),
        campaignId: CAMPAIGN,
        anonymousId: anon,
        value: 89,
        currency: 'usd',
      }),
    ).toEqual({
      eventId: 'subscription_payment:txn_1',
      name: 'subscription_payment',
      occurredAt: '2026-09-25T00:00:00.000Z',
      variantId: VARIANT,
      campaignId: CAMPAIGN,
      anonymousId: anon,
      value: 89,
      currency: 'USD',
    })
  })
  it('value and currency travel together; negative / non-finite values are dropped', () => {
    const base = { eventId: 'e', name: 'refund', occurredAt: '2026-09-25T00:00:00Z' }
    for (const extra of [{ value: 10 }, { currency: 'USD' }, { value: -1, currency: 'USD' }, { value: Number.NaN, currency: 'USD' }, { value: 5, currency: 'dollars' }]) {
      const event = buildEvent({ ...base, ...extra })
      expect(event).not.toHaveProperty('value')
      expect(event).not.toHaveProperty('currency')
    }
  })
  it('rejects invalid required fields', () => {
    const ok = { eventId: 'e', name: 'signup', occurredAt: '2026-09-25T00:00:00Z' }
    expect(buildEvent({ ...ok, eventId: '  ' })).toBeNull()
    expect(buildEvent({ ...ok, eventId: 'x'.repeat(201) })).toBeNull()
    expect(buildEvent({ ...ok, name: 'Sign Up' })).toBeNull()
    expect(buildEvent({ ...ok, name: 'own-db' })).toBeNull()
    expect(buildEvent({ ...ok, occurredAt: 'yesterday' })).toBeNull()
  })
  it('drops an anonymousId that is not 16–128 hex/hyphen chars', () => {
    const base = { eventId: 'e', name: 'signup', occurredAt: '2026-09-25T00:00:00Z' }
    expect(buildEvent({ ...base, anonymousId: 'user@example.com' })).not.toHaveProperty('anonymousId')
    expect(buildEvent({ ...base, anonymousId: 'abc123' })).not.toHaveProperty('anonymousId')
  })
})

describe('anonymousIdForOrg', () => {
  it('is stable, 64 hex chars, keyed, and does not embed the org id', () => {
    const orgId = '11111111-2222-4333-8444-555555555555'
    const a = anonymousIdForOrg(orgId, 'secret-a')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(anonymousIdForOrg(orgId, 'secret-a')).toBe(a)
    expect(anonymousIdForOrg(orgId, 'secret-b')).not.toBe(a)
    expect(anonymousIdForOrg('22222222-2222-4333-8444-555555555555', 'secret-a')).not.toBe(a)
    expect(a).not.toContain(orgId.replace(/-/g, ''))
  })
})

describe('Paddle mapping', () => {
  const now = new Date('2026-09-25T00:00:00Z')

  it('minor → major: 2-decimal and zero-decimal currencies', () => {
    expect(minorAmountToMajor('8900', 'USD')).toBe(89)
    expect(minorAmountToMajor('1999', 'usd')).toBe(19.99)
    expect(minorAmountToMajor('29000', 'KRW')).toBe(29000) // KRW has no minor unit — never /100
    expect(minorAmountToMajor('12.5', 'USD')).toBeNull()
    expect(minorAmountToMajor(null, 'USD')).toBeNull()
    expect(minorAmountToMajor('100', null)).toBeNull()
  })

  it('a settled org transaction → subscription_payment keyed on the transaction id', () => {
    expect(
      paymentEventFromTransaction(
        {
          id: 'txn_01',
          status: 'completed',
          currency_code: 'USD',
          details: { totals: { grand_total: '8900' } },
          billed_at: '2026-09-24T10:00:00Z',
          custom_data: { org_id: 'org-1' },
        },
        now,
      ),
    ).toEqual({
      eventId: 'subscription_payment:txn_01',
      name: 'subscription_payment',
      occurredAt: '2026-09-24T10:00:00Z',
      value: 89,
      currency: 'USD',
    })
  })

  it('excludes proxy-gateway transactions, $0 transactions and unsettled ones', () => {
    const txn = { id: 'txn_02', status: 'completed', currency_code: 'USD', details: { totals: { grand_total: '8900' } } }
    const proxyData = { proxy: 1, partner_code: 'partnerapp', proxy_subscription_id: 'psub_1', partner_user_id: 'u1' }
    // the local predicate must agree with the proxy module's routing predicate
    expect(isProxyCustomData(proxyData)).toBe(true)
    expect(paymentEventFromTransaction({ ...txn, custom_data: proxyData }, now)).toBeNull()
    expect(paymentEventFromTransaction({ ...txn, details: { totals: { grand_total: '0' } } }, now)).toBeNull()
    expect(paymentEventFromTransaction({ ...txn, status: 'billed' }, now)).toBeNull()
    expect(paymentEventFromTransaction({ ...txn, status: 'paid' }, now)?.eventId).toBe('subscription_payment:txn_02')
  })

  it('approved refund → refund with the ADJUSTMENT amount (partial refunds stay partial)', () => {
    expect(
      refundEventFromAdjustment(
        {
          id: 'adj_01',
          action: 'refund',
          status: 'approved',
          transaction_id: 'txn_01',
          totals: { total: '2500', currency_code: 'USD' },
          updated_at: '2026-09-25T01:00:00Z',
        },
        'USD',
        now,
      ),
    ).toEqual({ eventId: 'refund:adj_01', name: 'refund', occurredAt: '2026-09-25T01:00:00Z', value: 25, currency: 'USD' })
  })

  it('chargebacks count as refunds; pending/rejected/credit adjustments do not', () => {
    const adj = { id: 'adj_02', transaction_id: 'txn_01', totals: { total: '8900' } }
    expect(refundEventFromAdjustment({ ...adj, action: 'chargeback' }, 'USD', now)?.name).toBe('refund')
    expect(refundEventFromAdjustment({ ...adj, action: 'refund', status: 'pending_approval' }, 'USD', now)).toBeNull()
    expect(refundEventFromAdjustment({ ...adj, action: 'refund', status: 'rejected' }, 'USD', now)).toBeNull()
    expect(refundEventFromAdjustment({ ...adj, action: 'credit', status: 'approved' }, 'USD', now)).toBeNull()
    expect(refundEventFromAdjustment({ id: 'adj_03', action: 'refund' }, 'USD', now)).toBeNull()
  })

  it('a refund without a readable amount is still recorded, just without value', () => {
    const event = refundEventFromAdjustment({ id: 'adj_04', action: 'refund', transaction_id: 'txn_01' }, 'KRW', now)
    expect(event).toMatchObject({ eventId: 'refund:adj_04', value: null, currency: null })
  })
})
