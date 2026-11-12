import { describe, expect, it, vi } from 'vitest'
import { common, elements, localClient, oneElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

const translate = Object.assign((key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key, {
  rich: (key: string, values: Record<string, (text: string) => unknown>) => [key, ...Object.values(values).map(render => render('sample'))],
})

const loginChrome = {
  '@/components/brand/LogoMark': 'LogoMark', '@/components/i18n/LanguageSwitcher': 'LanguageSwitcher', './login.module.css': {},
  '@/components/landing/Footer': { COMPANY: { name: 'Example company' } }, 'lucide-react': { CircleAlert: 'CircleAlert', ShieldCheck: 'ShieldCheck' },
  '@/components/landing/editorial/editorial.css': {}, '@/components/landing/editorial/fonts': { editorialFontVariables: 'fonts' },
}

describe('account and payment entry assembly without live authorization or payment IO', () => {
  for (const mode of ['pending', 'missing', 'deleted', 'processed', 'expired', 'mismatch', 'read-failed', 'anonymous']) {
    it(`invitation page preserves account/expiry/read-failure branching (${mode})`, async () => {
      const client = { auth: { getUser: async () => ({ data: { user: mode === 'anonymous' ? null : { id: 'user-a', email: mode === 'mismatch' ? 'different@example.invalid' : 'Invitee@example.invalid' } } }) } }
      const preview = {
        email: 'invitee@example.invalid', role: 'member', status: mode === 'processed' ? 'accepted' : 'pending',
        expires_at: mode === 'expired' ? '2000-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
        organizations: { name: 'Example workspace', deleted_at: mode === 'deleted' ? '2026-01-01' : null },
      }
      const admin = {}, createAdmin = vi.fn(() => admin)
      const read = vi.fn(async () => { if (mode === 'read-failed') throw new Error('Local preview unavailable'); return mode === 'missing' ? null : preview })
      const page = loadRoute('app/invite/[token]/page.tsx', {
        ...common, 'next-intl/server': { getTranslations: async () => translate },
        '@/utils/supabase/server': { createClient: async () => client }, '@/utils/supabase/admin': { createAdminClient: createAdmin },
        './AcceptForm': { AcceptForm: 'AcceptForm' },
        './InvitationShell': { InvitationShell: 'InvitationShell', InvitationFailure: 'InvitationFailure', InvitationReady: 'InvitationReady' },
        './invitation-preview': { readInvitationPreview: read },
      })
      const result = page.default({ params: Promise.resolve({ token: 'local-invite-token' }) })
      if (mode === 'anonymous') {
        await expect(result).rejects.toThrow('REDIRECT:/login?next=/app/invite/local-invite-token')
        expect(createAdmin).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); return
      }
      const tree = await result
      expect(read).toHaveBeenCalledExactlyOnceWith(admin, 'local-invite-token')
      if (mode === 'pending') {
        expect(oneElement(tree, 'AcceptForm').props).toEqual({ token: 'local-invite-token' })
        expect(oneElement(tree, 'InvitationReady').props.description).toContain('Example workspace')
      } else {
        expect(elements(tree, 'AcceptForm')).toHaveLength(0)
        const failure = oneElement(tree, 'InvitationFailure')
        const key = ({ missing: 'notFound', deleted: 'notFound', processed: 'processed', expired: 'expired', mismatch: 'mismatch', 'read-failed': 'previewUnavailable' } as Record<string, string>)[mode]
        expect(failure.props.message).toContain(`accept.${key}`)
        if (mode === 'mismatch') {
          expect(failure.props.message).toContain('in*****@example.invalid')
          expect(failure.props.message).not.toContain('invitee@example.invalid')
        }
        if (mode === 'read-failed') expect(failure.props.retry).toEqual({ href: '/app/invite/local-invite-token', label: 'accept.reload' })
      }
    })
  }
  for (const locale of ['en', 'ko', 'ja']) {
    it(`login keeps localized home/legal links and sanitized form destination (${locale})`, async () => {
      const { client } = localClient({}, false)
      const page = loadRoute('login/page.tsx', {
        ...common, 'next/link': 'Link', 'next-intl/server': { getTranslations: async () => translate, getLocale: async () => locale },
        '@/utils/supabase/server': { createClient: async () => client }, '@/components/auth/LoginForm': { LoginForm: 'LoginForm' },
        ...loginChrome,
      })
      const tree = await page.default({ searchParams: Promise.resolve({ next: '//example.invalid', error: '__proto__' }) })
      expect(oneElement(tree, 'LoginForm').props.next).toBe('/app/ask')
      const prefix = locale === 'en' ? '' : `/${locale}`
      expect(elements(tree, 'Link').map(link => link.props.href)).toEqual([prefix || '/', `${prefix}/demo`, prefix || '/', `${prefix}/terms`, `${prefix}/privacy`])
      // Cookie-driven route: switching language refreshes in place (no /ko/login navigation).
      expect(oneElement(tree, 'LanguageSwitcher').props).toMatchObject({ variant: 'app' })
    })
  }
  for (const next of ['/app/settings', '//example.invalid', '/\\example.invalid', '/\n/example.invalid']) {
    it(`signed-in login redirects safely before rendering a form (${JSON.stringify(next)})`, async () => {
      const { client } = localClient()
      const page = loadRoute('login/page.tsx', {
        ...common, 'next/link': 'Link', '@/utils/supabase/server': { createClient: async () => client },
        '@/components/auth/LoginForm': {}, ...loginChrome,
      })
      await expect(page.default({ searchParams: Promise.resolve({ next }) })).rejects.toThrow(`REDIRECT:${next === '/app/settings' ? next : '/app/ask'}`)
    })
  }
  for (const status of ['pending', 'active', 'canceled']) {
    it(`checkout preserves pending props and settled/failed partner redirects (${status})`, async () => {
      const { client, calls } = localClient({ proxy_subscriptions: [{
        id: 'subscription-a', status, customer_email: 'sample@example.invalid',
        success_url: 'https://example.invalid/done?existing=1', fail_url: 'https://example.invalid/failed',
        proxy_partners: [{ name: 'Example partner' }], proxy_products: { sku: 'sample' },
      }] })
      const config = vi.fn(() => ({ token: 'local-public-client-token', environment: 'sandbox' }))
      const page = loadRoute('proxy/checkout/page.tsx', {
        ...common, '@/utils/supabase/admin': { createAdminClient: () => client },
        '@/lib/paddle/config': { getPaddleClientConfig: config }, './checkout-client': { ProxyCheckoutClient: 'ProxyCheckoutClient' }, './checkout-metadata': {},
      })
      const result = page.default({ searchParams: Promise.resolve({ _ptxn: 'local-transaction' }) })
      if (status === 'pending') {
        expect(oneElement(await result, 'ProxyCheckoutClient').props).toEqual({ transactionId: 'local-transaction', partnerName: 'Example partner', customerEmail: 'sample@example.invalid',
          successUrl: 'https://example.invalid/done?existing=1&subscription_id=subscription-a&status=success',
          failUrl: 'https://example.invalid/failed?subscription_id=subscription-a&status=canceled', clientToken: 'local-public-client-token', environment: 'sandbox',
        })
      } else {
        await expect(result).rejects.toThrow(status === 'active'
          ? 'REDIRECT:https://example.invalid/done?existing=1&subscription_id=subscription-a&status=success'
          : 'REDIRECT:https://example.invalid/failed?subscription_id=subscription-a&status=failed&reason=canceled')
        expect(config).not.toHaveBeenCalled()
      }
      expect(calls).toContainEqual(['proxy_subscriptions', 'eq', 'paddle_checkout_txn_id', 'local-transaction'])
    })
  }
  it('missing checkout transaction stops before privileged lookup or provider configuration', async () => {
    const forbidden = vi.fn(() => { throw new Error('Unexpected access') })
    const page = loadRoute('proxy/checkout/page.tsx', {
      ...common, '@/utils/supabase/admin': { createAdminClient: forbidden }, '@/lib/paddle/config': { getPaddleClientConfig: forbidden }, './checkout-client': {}, './checkout-metadata': {},
    })
    await expect(page.default({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND')
    expect(forbidden).not.toHaveBeenCalled()
  })
})
