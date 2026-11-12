import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pin: the double-submit guard must hold under the TOCTOU race. The window SELECT can miss a
 * concurrent identical insert; the partial unique index agent_runs_inflight_uniq then rejects
 * the second insert with 23505 — which must surface as `duplicate` (one run, one bill), never
 * as a second run or a raw failure.
 */

// FIFO of results for successive select→…→limit chains (dedupe window, then winner lookup)
const selectResults: Array<{ data: unknown[] | null }> = []
let insertResult: { error: { code?: string; message?: string } | null } = { error: null }
/** When non-empty, successive inserts drain this instead of `insertResult` (retry tests). */
const insertQueue: Array<{ error: { code?: string; message?: string } | null }> = []
/** Every row handed to insert(), so a test can assert what was (or wasn't) written. */
const insertedRows: Array<Record<string, unknown>> = []

function selectChain() {
  const c = {
    eq: () => c,
    in: () => c,
    gte: () => c,
    limit: async () => selectResults.shift() ?? { data: [] },
  }
  return c
}

vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    from: () => ({
      select: () => selectChain(),
      insert: async (row: Record<string, unknown>) => {
        insertedRows.push(row)
        return insertQueue.length > 0 ? insertQueue.shift()! : insertResult
      },
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  }),
}))

const triggerMock = vi.fn(async () => ({ id: 'trig_1' }))
vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: () => triggerMock() } }))

import { createAgentRun } from './create-run'

const INPUT = {
  orgId: 'org1',
  dataSourceId: 'ds1',
  userId: 'u1',
  question: 'q',
  taskId: 'analyze',
}

beforeEach(() => {
  selectResults.length = 0
  insertQueue.length = 0
  insertedRows.length = 0
  insertResult = { error: null }
  triggerMock.mockClear()
})

afterEach(() => {
  delete process.env.TRIGGER_SECRET_KEY
})

describe('createAgentRun double-submit guard', () => {
  it('returns duplicate from the window SELECT (fast path)', async () => {
    selectResults.push({ data: [{ id: 'existing' }] })
    const res = await createAgentRun(INPUT)
    expect(res).toEqual({ status: 'duplicate', runId: 'existing' })
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('maps a 23505 unique violation (lost race) to duplicate with the winning run id', async () => {
    selectResults.push({ data: [] }) // window SELECT misses the concurrent insert
    insertResult = { error: { code: '23505', message: 'duplicate key value violates "agent_runs_inflight_uniq"' } }
    selectResults.push({ data: [{ id: 'winner' }] }) // in-flight winner lookup
    const res = await createAgentRun(INPUT)
    expect(res).toEqual({ status: 'duplicate', runId: 'winner' })
    expect(triggerMock).not.toHaveBeenCalled() // the loser must NOT dispatch a second task
  })

  it('keeps returning insert_failed on non-unique insert errors', async () => {
    selectResults.push({ data: [] })
    insertResult = { error: { code: '23502', message: 'null value' } }
    const res = await createAgentRun(INPUT)
    expect(res).toEqual({ status: 'insert_failed' })
  })

  it('creates + triggers on the clean path', async () => {
    process.env.TRIGGER_SECRET_KEY = 'tr_test'
    selectResults.push({ data: [] })
    const res = await createAgentRun(INPUT)
    expect(res.status).toBe('created')
    expect(triggerMock).toHaveBeenCalledTimes(1)
  })
})

/**
 * Pin: `agent_runs.channel` ships in a migration that may land AFTER this code. Writing it
 * unconditionally would make every run creation fail with 42703 on a deploy-before-migrate, so
 * the insert retries without the column — and only for that error.
 */
describe('createAgentRun channel column', () => {
  it('stamps the channel, defaulting to web', async () => {
    await createAgentRun(INPUT)
    expect(insertedRows[0].channel).toBe('web')

    insertedRows.length = 0
    await createAgentRun({ ...INPUT, channel: 'mcp' })
    expect(insertedRows[0].channel).toBe('mcp')
  })

  it('retries without the column when it does not exist yet (pre-migration)', async () => {
    insertQueue.push({ error: { code: '42703', message: 'column "channel" does not exist' } }, { error: null })
    const res = await createAgentRun({ ...INPUT, channel: 'slack' })
    expect(res.status).toBe('no_worker') // inserted fine; no TRIGGER_SECRET_KEY in this test env
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows[0].channel).toBe('slack')
    expect(insertedRows[1]).not.toHaveProperty('channel')
  })

  it('does NOT retry on an unrelated insert failure', async () => {
    insertQueue.push({ error: { code: '23514', message: 'check constraint violated' } })
    const res = await createAgentRun(INPUT)
    expect(res.status).toBe('insert_failed')
    expect(insertedRows).toHaveLength(1)
  })
})
