import { afterEach, describe, expect, it, vi } from 'vitest'

import { publicDemoConfigured } from '@/lib/demo/public-demo'
import { PLAN_LIMITS, entitledPlan, getPlanLimit, getPlanLimits } from '@/lib/plans/limits'
import { xrayConfigured } from '@/lib/xray/config'

afterEach(() => vi.unstubAllEnvs())

const selfhost = () => vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'selfhost')
const cloud = () => vi.stubEnv('NEXT_PUBLIC_SUPALENS_EDITION', 'cloud')

/** What a self-hosted install must and must not get. These are the seams where the hosted
 *  service's rules would otherwise leak into someone else's deployment. */
describe('edition gates', () => {
  it('self-hosted orgs are unlimited whatever plan the row carries', () => {
    selfhost()
    expect(getPlanLimits('free')).toBe(PLAN_LIMITS.premium)
    expect(getPlanLimits(null)).toBe(PLAN_LIMITS.premium)
    expect(getPlanLimit('free', 'alerts_per_org')).toBe(-1)
    expect(entitledPlan('free', null)).toBe('premium')
    expect(entitledPlan('basic', 'canceled')).toBe('premium')
  })

  it('the hosted edition keeps plan enforcement', () => {
    cloud()
    expect(getPlanLimits('free')).toBe(PLAN_LIMITS.free)
    expect(entitledPlan('basic', 'canceled')).toBe('free')
    expect(entitledPlan('basic', 'active')).toBe('basic')
  })

  it('anonymous LLM surfaces never turn on for a self-hosted install', () => {
    vi.stubEnv('TRIGGER_SECRET_KEY', 'tr_x')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
    vi.stubEnv('PUBLIC_DEMO_ORG_ID', '00000000-0000-4000-8000-000000000001')
    vi.stubEnv('DEMO_DATABASE_URL', 'postgres://demo')
    selfhost()
    expect(xrayConfigured()).toBe(false)
    expect(publicDemoConfigured()).toBe(false)
    cloud()
    expect(xrayConfigured()).toBe(true)
    expect(publicDemoConfigured()).toBe(true)
  })
})
