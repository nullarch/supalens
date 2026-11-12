import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the anti-"email-bomb" invariant of the weekly digest: one org → ONE email, no matter
 * how many data sources it has (the old runner fanned out one email PER source). The agent
 * runs once per source; the summaries are consolidated into a SINGLE sendDigestEmail call. A
 * source whose generation fails is skipped (not fatal), and an org whose every source yields
 * nothing gets NO email (never an empty digest).
 *
 * The deterministic operator sections (monitor health / incidents / review queue) are absent
 * here because the mocked admin client has no `.from` — they are best-effort and degrade to
 * null, which is exactly the contract: a digest must still go out on the agent summaries alone.
 */

const runByEngine = vi.fn()
vi.mock('@/lib/agent/run-by-engine', () => ({
  runByEngine: (...a: unknown[]) => runByEngine(...(a as [])),
}))

vi.mock('@/lib/agent/models', () => ({ SYSTEM_RUN_MODEL: 'claude-test' }))

const sendDigestEmail = vi.fn()
vi.mock('@/lib/email/digest', () => ({
  sendDigestEmail: (...a: unknown[]) => sendDigestEmail(...(a as [])),
}))

const recipientsDetailFor = vi.fn()
vi.mock('@/lib/alerts/runner', () => ({
  recipientsDetailFor: (...a: unknown[]) => recipientsDetailFor(...(a as [])),
}))

vi.mock('@/lib/i18n/resolve-locale', () => ({ resolveOrgLocale: async () => 'ko' }))

/**
 * Rows the deterministic operator sections read from supalens's own Postgres. The default
 * (`requireAdminClient: () => ({})`) has no `.from`, so those sections throw and degrade to null —
 * which is what the first three tests rely on. `withOperatorData` swaps in a real chain.
 */
const operator = { enabled: false, alerts: [] as unknown[], events: [] as unknown[], counts: 0 }
vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => {
    if (!operator.enabled) return {} // no `.from` → every operator section degrades to null
    const rows = (data: unknown[]) => {
      const b = {
        select: () => b,
        eq: () => b,
        gte: () => b,
        in: () => b,
        is: () => b,
        order: () => b,
        limit: () => Promise.resolve({ data, error: null, count: operator.counts }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data, error: null, count: operator.counts }),
      }
      return b
    }
    return {
      from: (table: string) => {
        if (table === 'alerts') return rows(operator.alerts)
        if (table === 'alert_events') return rows(operator.events)
        return rows([]) // kpi_catalog / data_source_context → head counts
      },
    }
  },
}))

import { runOrgWeeklyDigest } from './generate'

const src = (id: string, name: string, engine = 'postgres') => ({ dataSourceId: id, name, engine })

beforeEach(() => {
  runByEngine.mockReset().mockResolvedValue({ ok: true, text: 'weekly summary' })
  sendDigestEmail.mockReset().mockResolvedValue({ sent: true })
  recipientsDetailFor.mockReset().mockResolvedValue([{ email: 'owner@x.com', userId: 'u1' }])
  operator.enabled = false
  operator.alerts = []
  operator.events = []
  operator.counts = 0
})

describe('runOrgWeeklyDigest — one email per org', () => {
  it('consolidates N sources into ONE email (not one per source)', async () => {
    const res = await runOrgWeeklyDigest({
      orgId: 'org1',
      orgName: 'Acme',
      sources: [src('d1', 'Prod DB'), src('d2', 'Analytics'), src('d3', 'Events', 'firestore')],
      moreCount: 2,
    })
    expect(runByEngine).toHaveBeenCalledTimes(3) // generated per source
    expect(sendDigestEmail).toHaveBeenCalledTimes(1) // …but emailed once
    const arg = sendDigestEmail.mock.calls[0][0]
    expect(arg.orgId).toBe('org1')
    expect(arg.sections.map((s: { name: string }) => s.name)).toEqual([
      '가장 큰 KPI 변화 · Prod DB',
      '가장 큰 KPI 변화 · Analytics',
      '가장 큰 KPI 변화 · Events',
    ])
    expect(arg.moreCount).toBe(2)
    expect(res).toMatchObject({ ok: true, sent: true, sources: 3 })
  })

  it('skips a failing source but still sends the others in one email', async () => {
    runByEngine
      .mockReset()
      .mockResolvedValueOnce({ ok: true, text: 'ok A' })
      .mockRejectedValueOnce(new Error('tenant DB down'))
      .mockResolvedValueOnce({ ok: true, text: 'ok C' })
    const res = await runOrgWeeklyDigest({
      orgId: 'org1',
      orgName: 'Acme',
      sources: [src('d1', 'A'), src('d2', 'B'), src('d3', 'C')],
      moreCount: 0,
    })
    expect(sendDigestEmail).toHaveBeenCalledTimes(1)
    expect(sendDigestEmail.mock.calls[0][0].sections.map((s: { name: string }) => s.name)).toEqual([
      '가장 큰 KPI 변화 · A',
      '가장 큰 KPI 변화 · C',
    ])
    expect(res.sources).toBe(2)
  })

  it('never sends an empty digest (every source blank → no email)', async () => {
    runByEngine.mockReset().mockResolvedValue({ ok: true, text: '   ' })
    const res = await runOrgWeeklyDigest({
      orgId: 'org1',
      orgName: 'Acme',
      sources: [src('d1', 'A')],
      moreCount: 0,
    })
    expect(sendDigestEmail).not.toHaveBeenCalled()
    expect(res).toMatchObject({ ok: false, sent: false, sources: 0 })
  })
})

/**
 * The "never send an empty digest" gate used to be `sections.length === 0`, which was UNREACHABLE:
 * incidentsSection always returns a section — the reassuring "no incidents this week" line — so an
 * opted-in paid org with no monitors, no events and a failed summary still got a mail whose entire
 * content was "nothing happened". The gate now asks for REAL content.
 */
describe('runOrgWeeklyDigest — what counts as content worth mailing', () => {
  it('does NOT mail when the only "content" is the no-incidents line', async () => {
    operator.enabled = true // sections DO run now; they just have nothing to report
    runByEngine.mockReset().mockRejectedValue(new Error('agent down'))

    const res = await runOrgWeeklyDigest({
      orgId: 'org1',
      orgName: 'Acme',
      sources: [src('d1', 'A')],
      moreCount: 0,
    })

    expect(sendDigestEmail).not.toHaveBeenCalled()
    expect(res).toMatchObject({ ok: false, sent: false, sources: 0 })
  })

  it('DOES mail on monitor health alone — "N watching, 0 firing" is the report', async () => {
    operator.enabled = true
    operator.alerts = [{ enabled: true, status: 'ok', last_error: null }]
    runByEngine.mockReset().mockRejectedValue(new Error('agent down'))

    const res = await runOrgWeeklyDigest({
      orgId: 'org1',
      orgName: 'Acme',
      sources: [src('d1', 'A')],
      moreCount: 0,
    })

    expect(sendDigestEmail).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({ ok: true, sent: true, sources: 0 })
  })

  it('DOES mail when something actually fired this week, even with no monitors listed', async () => {
    operator.enabled = true
    operator.events = [
      { id: 'e1', alert_id: 'a1', kind: 'fired', value: 3, created_at: '2026-09-01T00:00:00Z', explanation: null, alerts: { name: 'Signups' } },
    ]
    runByEngine.mockReset().mockRejectedValue(new Error('agent down'))

    const res = await runOrgWeeklyDigest({
      orgId: 'org1',
      orgName: 'Acme',
      sources: [src('d1', 'A')],
      moreCount: 0,
    })

    expect(sendDigestEmail).toHaveBeenCalledTimes(1)
    expect(res.sent).toBe(true)
  })
})
