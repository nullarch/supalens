import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the metering contract of the root-cause investigation path.
 *
 * Before: `runAlertExplanation` gated on `checkUsageQuota` but never incremented, so an org's
 * investigations were invisible to billing and the gate only ever reflected OTHER paths' usage —
 * a hole in the "every LLM entry point meters" invariant (core-dev-guard §1).
 *
 * After: the investigation is a real `agent_runs` row and `persistRun` meters it. The two
 * metering branches (persistRun vs the direct fallback) must be MUTUALLY EXCLUSIVE — metering
 * twice would double-bill a firing monitor.
 */

const runAnalysis = vi.fn()
vi.mock('@/lib/agent/run-analysis', () => ({ runAnalysis: (...a: unknown[]) => runAnalysis(...(a as [])) }))
vi.mock('@/lib/agent/models', () => ({ SYSTEM_RUN_MODEL: 'claude-test' }))

const persistRun = vi.fn(async () => {})
vi.mock('@/lib/agent/run-record', () => ({ persistRun: (...a: unknown[]) => persistRun(...(a as [])) }))

const checkUsageQuota = vi.fn(async () => ({ allowed: true }))
const incrementUsage = vi.fn(async () => {})
vi.mock('@/lib/plans/usage', () => ({
  checkUsageQuota: (...a: unknown[]) => checkUsageQuota(...(a as [])),
  incrementUsage: (...a: unknown[]) => incrementUsage(...(a as [])),
}))

const sendAlertEmail = vi.fn(async () => ({ sent: true }))
vi.mock('@/lib/email/alert', () => ({ sendAlertEmail: (...a: unknown[]) => sendAlertEmail(...(a as [])) }))
const notifyChannels = vi.fn(async () => true)
vi.mock('@/lib/notify/dispatch', () => ({ notifyChannels: (...a: unknown[]) => notifyChannels(...(a as [])) }))
vi.mock('./runner', () => ({
  recipientsDetailFor: async () => [{ email: 'a@b.c', userId: 'u1' }],
  orgNameOf: async () => 'Acme',
}))

/** Insert outcomes, drained in order; `updates` records every alert_events patch. */
const insertResults: Array<{ error: { code?: string; message?: string } | null }> = []
const insertedRows: Array<Record<string, unknown>> = []
const updates: Array<Record<string, unknown>> = []

vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        if (table === 'agent_runs') insertedRows.push(row)
        return insertResults.shift() ?? { error: null }
      },
      update: (patch: Record<string, unknown>) => {
        if (table === 'alert_events') updates.push(patch)
        return { eq: async () => ({ error: null }) }
      },
    }),
  }),
}))

import { runAlertExplanation, type ExplainAlertArgs } from './explain'

const ARGS: ExplainAlertArgs = {
  alertId: 'al1',
  eventId: 'ev1',
  orgId: 'org1',
  dataSourceId: 'ds1',
  alertName: 'Daily revenue',
  metricSql: 'select 1',
  value: 100,
  operator: 'lt',
  threshold: 200,
  message: '100 < 200',
  runId: 'runner-actor-id',
}

const RESULT = {
  ok: true,
  text: 'Renewals fell 31%.',
  turns: 3,
  costUsd: 0.02,
  tokensIn: 1000,
  tokensOut: 200,
  visualizations: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  insertResults.length = 0
  insertedRows.length = 0
  updates.length = 0
  runAnalysis.mockResolvedValue(RESULT)
  checkUsageQuota.mockResolvedValue({ allowed: true })
})

describe('runAlertExplanation metering', () => {
  it('meters exactly once, through persistRun, when the run row opens', async () => {
    await runAlertExplanation(ARGS)
    expect(persistRun).toHaveBeenCalledTimes(1)
    expect(incrementUsage).not.toHaveBeenCalled()
  })

  it('falls back to a direct increment when the run row cannot be opened', async () => {
    insertResults.push({ error: { code: '23505', message: 'duplicate key' } })
    await runAlertExplanation(ARGS)
    expect(persistRun).not.toHaveBeenCalled()
    expect(incrementUsage).toHaveBeenCalledTimes(1)
    expect(incrementUsage).toHaveBeenCalledWith('org1', 1, 1200)
  })

  it('meters a FAILED investigation too — the tokens were still spent', async () => {
    runAnalysis.mockRejectedValue(new Error('agent crashed'))
    await runAlertExplanation(ARGS)
    expect(persistRun).toHaveBeenCalledTimes(1)
    expect((persistRun.mock.calls[0] as unknown[])[1]).toMatchObject({ ok: false })
    expect(incrementUsage).not.toHaveBeenCalled()
  })

  it('never meters when the quota gate blocked the run (nothing executed)', async () => {
    checkUsageQuota.mockResolvedValue({ allowed: false })
    await runAlertExplanation(ARGS)
    expect(runAnalysis).not.toHaveBeenCalled()
    expect(persistRun).not.toHaveBeenCalled()
    expect(incrementUsage).not.toHaveBeenCalled()
    expect(insertedRows).toHaveLength(0)
  })
})

describe('runAlertExplanation run record', () => {
  it('opens an incident-channel run, RUNNING so persistRun can close it', async () => {
    await runAlertExplanation(ARGS)
    expect(insertedRows[0]).toMatchObject({
      org_id: 'org1',
      data_source_id: 'ds1',
      user_id: null,
      status: 'running',
      channel: 'incident',
    })
  })

  it('stores a readable label, not the multi-paragraph prompt', async () => {
    await runAlertExplanation(ARGS)
    const question = insertedRows[0].question as string
    expect(question).toBe('Why did "Daily revenue" fire?')
    expect(question).not.toContain('Investigate the DATA')
  })

  it('retries the insert without `channel` before the migration lands', async () => {
    insertResults.push({ error: { code: '42703', message: 'column "channel" does not exist' } }, { error: null })
    await runAlertExplanation(ARGS)
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows[1]).not.toHaveProperty('channel')
    expect(persistRun).toHaveBeenCalledTimes(1)
  })

  it('points alert_events.explanation_run_id at the run it opened', async () => {
    await runAlertExplanation(ARGS)
    const patch = updates.find((u) => 'explained' in u)
    expect(patch?.explanation_run_id).toBe(insertedRows[0].id)
    expect(patch?.explanation).toBe('Renewals fell 31%.')
  })

  it('leaves explanation_run_id unset rather than dangling when no row was opened', async () => {
    insertResults.push({ error: { code: '23505', message: 'duplicate key' } })
    await runAlertExplanation(ARGS)
    const patch = updates.find((u) => 'explained' in u)
    expect(patch).toBeDefined()
    expect(patch).not.toHaveProperty('explanation_run_id')
  })

  it('still notifies when the investigation fails (plain fallback preserved)', async () => {
    runAnalysis.mockRejectedValue(new Error('agent crashed'))
    const r = await runAlertExplanation(ARGS)
    expect(r).toMatchObject({ ok: false, sent: true })
    expect(sendAlertEmail).toHaveBeenCalledTimes(1)
    expect(notifyChannels).toHaveBeenCalledTimes(1)
  })
})
