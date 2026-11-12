import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pin: persistRun only finalizes a LIVE (queued/running) run. A task completing after the
 * user cancelled (or after the stuck-run reaper fired) must NOT resurrect the terminal row
 * to 'succeeded' — and must NOT meter usage for it (billing invariant).
 *
 * Also pins that metering goes through the incrementUsage WRAPPER (which owns the 80%/100%
 * quota emails), not the raw increment_org_usage RPC — the raw call silently disabled quota
 * emails on the main metering path once already.
 */

interface Row {
  status: string
  org_id: string
  data_source_id: string | null
  user_id?: string | null
}

const rows = new Map<string, Row>()
const incrementUsage = vi.fn(async () => {})
const sendFirstAnalysisToHub = vi.fn(async () => {})
let dsIsDemo = false

vi.mock('@/lib/event-hub/events', () => ({
  sendFirstAnalysisToHub: (...args: unknown[]) => sendFirstAnalysisToHub(...(args as [])),
}))

vi.mock('@/lib/plans/usage', () => ({
  incrementUsage: (...args: unknown[]) => incrementUsage(...(args as [])),
}))

vi.mock('@/utils/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'agent_runs') {
        return {
          update: (vals: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => ({
              in: (_st: string, statuses: string[]) => ({
                select: () => ({
                  maybeSingle: async () => {
                    const row = rows.get(id)
                    if (!row || !statuses.includes(row.status)) return { data: null, error: null }
                    row.status = vals.status as string
                    return { data: { org_id: row.org_id, data_source_id: row.data_source_id, user_id: row.user_id }, error: null }
                  },
                }),
              }),
            }),
          }),
        }
      }
      // data_sources is_demo lookup
      return {
        select: () => ({
          eq: () => ({ limit: async () => ({ data: [{ is_demo: dsIsDemo }], error: null }) }),
        }),
      }
    },
  }),
}))

// vi.mock is hoisted — importing after the mock declaration is safe
import { persistRun } from './run-record'

const RESULT = {
  ok: true,
  text: 'answer',
  turns: 2,
  costUsd: 0.1,
  tokensIn: 100,
  tokensOut: 200,
  visualizations: [],
}

beforeEach(() => {
  rows.clear()
  incrementUsage.mockClear()
  sendFirstAnalysisToHub.mockClear()
  dsIsDemo = false
})

describe('persistRun status guard', () => {
  it('finalizes a running run and meters usage once — via the incrementUsage wrapper', async () => {
    rows.set('r1', { status: 'running', org_id: 'org1', data_source_id: 'ds1' })
    await persistRun('r1', RESULT)
    expect(rows.get('r1')!.status).toBe('succeeded')
    expect(incrementUsage).toHaveBeenCalledTimes(1)
    expect(incrementUsage).toHaveBeenCalledWith('org1', 1, 300)
  })

  it('does NOT resurrect or meter a cancelled run (late-finishing task)', async () => {
    rows.set('r2', { status: 'cancelled', org_id: 'org1', data_source_id: 'ds1' })
    await persistRun('r2', RESULT)
    expect(rows.get('r2')!.status).toBe('cancelled')
    expect(incrementUsage).not.toHaveBeenCalled()
  })

  it('does NOT overwrite or meter a reaped (failed) run', async () => {
    rows.set('r3', { status: 'failed', org_id: 'org1', data_source_id: 'ds1' })
    await persistRun('r3', RESULT)
    expect(rows.get('r3')!.status).toBe('failed')
    expect(incrementUsage).not.toHaveBeenCalled()
  })

  it('still finalizes a queued run (local SSE path persists without markRunning)', async () => {
    rows.set('r4', { status: 'queued', org_id: 'org1', data_source_id: 'ds1' })
    await persistRun('r4', { ...RESULT, ok: false, error: 'boom' })
    expect(rows.get('r4')!.status).toBe('failed')
  })
})

describe('persistRun first_analysis', () => {
  const live = { status: 'running', org_id: 'org1', data_source_id: 'ds1', user_id: 'user-1' }

  it('offers a succeeded run after its row is final', async () => {
    rows.set('r1', { ...live })
    await persistRun('r1', RESULT)
    expect(sendFirstAnalysisToHub).toHaveBeenCalledWith(expect.anything(), 'user-1', 'r1')
  })

  it('skips failed, cancelled, demo and personless runs', async () => {
    rows.set('failed', { ...live })
    await persistRun('failed', { ...RESULT, ok: false, error: 'boom' })
    rows.set('cancelled', { ...live, status: 'cancelled' })
    await persistRun('cancelled', RESULT)
    rows.set('slack', { ...live, user_id: null })
    await persistRun('slack', RESULT)
    dsIsDemo = true
    rows.set('demo', { ...live })
    await persistRun('demo', RESULT)
    expect(sendFirstAnalysisToHub).not.toHaveBeenCalled()
  })
})
