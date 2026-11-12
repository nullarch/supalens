import { describe, expect, it, vi } from 'vitest'

/**
 * Pins the monitor CADENCE rule (`filterDueByPlan` → `planIntervalFor`).
 *
 * The defect: the runner read `organizations.plan` alone, so a premium org whose subscription had
 * lapsed (past_due / canceled) kept the 5-minute cadence forever — every other surface (the quota
 * gate, the billing page, the sidebar meter) already enforces `entitledPlan`, and the runner was
 * the one place that disagreed with them.
 *
 * `runner.ts` pulls the Trigger SDK, the query engine and the mailer at import time, so those are
 * stubbed; only the pure cadence decision is under test here.
 */

vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: vi.fn() } }))
vi.mock('@/lib/query', () => ({ executeReadOnly: vi.fn() }))
vi.mock('@/lib/email/alert', () => ({ sendAlertEmail: vi.fn() }))
vi.mock('@/lib/notify/dispatch', () => ({ notifyChannels: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ requireAdminClient: () => ({}) }))

import { planIntervalFor } from './runner'

const MIN = 60
const CRON_FLOOR = 5 * MIN // the evaluate-alerts cron ticks every 5 minutes; nothing beats that

describe('planIntervalFor', () => {
  it('applies each plan cadence, floored to the cron period', () => {
    expect(planIntervalFor({ plan: 'free', subscription_status: null })).toBe(2 * 60 * MIN)
    expect(planIntervalFor({ plan: 'basic', subscription_status: 'active' })).toBe(10 * MIN)
    expect(planIntervalFor({ plan: 'standard', subscription_status: 'active' })).toBe(CRON_FLOOR)
    // premium's declared 1m is floored — there is no 1-minute scheduler
    expect(planIntervalFor({ plan: 'premium', subscription_status: 'active' })).toBe(CRON_FLOOR)
  })

  it('trialing entitles the paid cadence', () => {
    expect(planIntervalFor({ plan: 'standard', subscription_status: 'trialing' })).toBe(CRON_FLOOR)
  })

  it('THROTTLES a lapsed paid plan to free cadence (the bug)', () => {
    for (const status of ['past_due', 'paused', 'canceled', null, undefined]) {
      expect(planIntervalFor({ plan: 'premium', subscription_status: status })).toBe(2 * 60 * MIN)
    }
  })

  it('treats an unknown / missing plan as free', () => {
    expect(planIntervalFor({ plan: 'enterprise', subscription_status: 'active' })).toBe(2 * 60 * MIN)
    expect(planIntervalFor({})).toBe(2 * 60 * MIN)
    expect(planIntervalFor(null)).toBe(2 * 60 * MIN)
  })
})
