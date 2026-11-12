import { describe, expect, it, vi } from 'vitest'
import en from '../../../../messages/en.json'
import ko from '../../../../messages/ko.json'
import ja from '../../../../messages/ja.json'

const state = vi.hoisted(() => ({ title: '' }))
vi.mock('next-intl/server', () => ({ getTranslations: async (namespace: string) => {
  expect(namespace).toBe('proxyCheckout')
  return (key: string) => { expect(key).toBe('metadataTitle'); return state.title }
} }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: () => { throw new Error('No DB access for metadata') } }))
vi.mock('@/lib/paddle/config', () => ({ getPaddleClientConfig: () => { throw new Error('No payment provider for metadata') } }))
vi.mock('./checkout-client', () => ({ ProxyCheckoutClient: () => null }))
import { generateMetadata } from './checkout-metadata'

describe('hosted checkout localization', () => {
  for (const [locale, catalog] of Object.entries({ en, ko, ja })) {
    it(`${locale} has complete nonempty copy for every controller state`, () => {
      expect(Object.keys(catalog.proxyCheckout).sort()).toEqual(Object.keys(en.proxyCheckout).sort())
      expect(Object.keys(catalog.proxyCheckout.states).sort()).toEqual(['loading', 'opening', 'open', 'closed', 'completed', 'error'].sort())
      for (const state of Object.values(catalog.proxyCheckout.states)) {
        expect(state.title.trim()).not.toBe('')
        expect(state.body.trim()).not.toBe('')
      }
      expect(catalog.proxyCheckout.title).toContain('{partner}')
      expect(catalog.proxyCheckout.return).toContain('{partner}')
    })
    it(`${locale} generates a localized non-indexable title without reading a transaction`, async () => {
      state.title = catalog.proxyCheckout.metadataTitle
      expect(await generateMetadata()).toEqual({ title: state.title, robots: { index: false, follow: false } })
    })
  }
})
