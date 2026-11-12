import { describe, expect, it, vi } from 'vitest'
import { loadRoute } from './route-harness.test-helper'

const user = { id: 'sample-user' }
const navigation = {
  redirect: (url: string): never => { throw new Error(`REDIRECT:${url}`) },
  notFound: (): never => { throw new Error('NOT_FOUND') },
}
const intl = { getTranslations: async () => (key: string) => key }
const common = { 'next/navigation': navigation, 'next-intl/server': intl }
type Element = { type: string; props: Record<string, unknown> }

function db(rows: Record<string, unknown[]>, signedIn = true) {
  const calls: unknown[][] = []
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: signedIn ? user : null } })) },
    from: vi.fn((table: string) => {
      const query = {
        select: (columns: string) => { calls.push([table, 'select', columns]); return query },
        eq: (key: string, value: unknown) => { calls.push([table, 'eq', key, value]); return query },
        is: (key: string, value: unknown) => { calls.push([table, 'is', key, value]); return query },
        limit: async (n: number) => { calls.push([table, 'limit', n]); return { data: rows[table] ?? [] } },
      }
      return query
    }),
  }
  return { client, calls }
}

describe('actual server route → redesigned view composition, local IO only', () => {
  for (const role of ['owner', 'admin', 'member', 'viewer', undefined]) {
    it(`monitor detail uses the monitor organization, not the selected one (${role})`, async () => {
      const { client, calls } = db({ organization_members: role ? [{ role }] : [], organizations: [{ plan: 'sample-plan' }] })
      const alert = { id: 'sample-monitor', orgId: 'monitor-org' }, events = [{ id: 'sample-event' }], targets = { email: false }
      const getTargets = vi.fn(async () => targets), timezone = vi.fn(async () => 'Asia/Tokyo')
      const page = loadRoute('app/monitors/[id]/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/org/server': { ensurePrimaryOrg: async () => 'different-selected-org' },
        '@/lib/alerts/server': { getAlert: async () => alert, listAlertEventsFor: async () => events, getNotificationTargets: getTargets },
        '@/lib/org/timezone': { getOrgTimezone: timezone },
        '@/lib/plans/limits': { getPlanLimit: (plan: string, key: string) => { expect([plan, key]).toEqual(['sample-plan', 'alert_min_check_interval']); return 300 } },
        '@/lib/alerts/evaluate': { effectiveCheckInterval: (value: number) => value },
        './MonitorDetailView': { MonitorDetailView: 'MonitorDetailView' },
      })
      const view = await page.default({ params: Promise.resolve({ id: 'sample-monitor' }) }) as Element
      expect(view.type).toBe('MonitorDetailView')
      expect(view.props).toEqual({ alert, events, targets, timezone: 'Asia/Tokyo', intervalSec: 300, canManage: ['owner', 'admin', 'member'].includes(role ?? ''), canConfigure: ['owner', 'admin'].includes(role ?? '') })
      expect(getTargets).toHaveBeenCalledExactlyOnceWith('monitor-org')
      expect(timezone).toHaveBeenCalledExactlyOnceWith(client, 'monitor-org')
      expect(calls).toContainEqual(['organization_members', 'eq', 'org_id', 'monitor-org'])
      expect(calls).toContainEqual(['organization_members', 'eq', 'user_id', user.id])
      expect(calls).toContainEqual(['organizations', 'eq', 'id', 'monitor-org'])
    })
  }
  for (const role of ['owner', 'admin', 'member', 'viewer']) {
    it(`settings passes selected-org identity and explicit preference values (${role})`, async () => {
      const { client, calls } = db({ organizations: [{ name: 'Sample org', slug: 'sample-org', weekly_digest_enabled: false }], organization_members: [{ role, email_digest_opt_out: true, email_alert_opt_out: false, email_lifecycle_opt_out: true }] })
      const page = loadRoute('app/settings/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/org/server': { ensurePrimaryOrg: async () => 'selected-org' },
        '@/lib/org/timezone': { readOrgTimezone: async () => ({ timezone: 'Asia/Seoul', pendingMigration: true }) },
        './SettingsView': { SettingsView: 'SettingsView' },
      })
      const view = await page.default() as Element
      expect(view.type).toBe('SettingsView')
      expect(view.props).toEqual({ orgId: 'selected-org', name: 'Sample org', slug: 'sample-org', timezone: 'Asia/Seoul', pendingMigration: true, canEditOrg: ['owner', 'admin'].includes(role), isOwner: role === 'owner', weeklyDigestEnabled: false, digestOptOut: true, alertOptOut: false, lifecycleOptOut: true })
      expect(calls).toContainEqual(['organizations', 'eq', 'id', 'selected-org'])
      expect(calls).toContainEqual(['organization_members', 'eq', 'org_id', 'selected-org'])
    })
  }
  for (const configured of [true, false]) for (const staff of [true, false]) {
    it(`billing retains summary/freshness/staff flags (${configured}/${staff})`, async () => {
      const { client } = db({})
      const summary = { sample: 'unchanged billing payload' }, reconcile = vi.fn(async () => {}), fresh = vi.fn(async () => {})
      const page = loadRoute('app/settings/billing/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/org/server': { ensurePrimaryOrg: async () => 'selected-org' },
        '@/lib/auth/is-admin': { isCurrentUserAdmin: async () => staff },
        '@/lib/plans/summary': { getBillingSummary: async (org: string) => { expect(org).toBe('selected-org'); return summary } },
        '@/lib/paddle/config': { isPaddleConfigured: () => configured, configuredPrices: () => [{ interval: 'year' }], adminTestPriceId: () => 'sample-price' },
        '@/lib/paddle/sync': { reconcileOrgSubscription: reconcile }, '@/lib/plans/usage': { ensureFreshPeriod: fresh },
        './BillingView': { BillingView: 'BillingView' },
      })
      const view = await page.default() as Element
      expect(view.type).toBe('BillingView')
      expect(view.props).toEqual({ summary, billingConfigured: configured, yearlyAvailable: configured, adminTestAvailable: configured && staff })
      expect(reconcile).toHaveBeenCalledTimes(configured ? 1 : 0)
      expect(fresh).toHaveBeenCalledTimes(configured ? 1 : 0)
    })
  }
  it('redirects unauthenticated settings before reading any organization data', async () => {
    const { client } = db({}, false)
    const forbidden = () => { throw new Error('Unexpected organization access') }
    const page = loadRoute('app/settings/page.tsx', {
      ...common, '@/utils/supabase/server': { createClient: async () => client },
      '@/lib/org/server': { ensurePrimaryOrg: forbidden }, '@/lib/org/timezone': { readOrgTimezone: forbidden },
      './SettingsView': { SettingsView: 'SettingsView' },
    })
    await expect(page.default()).rejects.toThrow('REDIRECT:/login?next=/app/settings')
    expect(client.from).not.toHaveBeenCalled()
  })
})
