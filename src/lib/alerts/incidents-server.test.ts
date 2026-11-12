import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the honesty rule of the incidents reader.
 *
 * The defect: BOTH readers retried with the base column list on ANY error and then discarded the
 * retry's error too, so an RLS denial, a dropped connection or a timeout all rendered as an empty
 * list — and this screen's empty state reads "no incidents", i.e. an ALL-CLEAR. An operator was
 * being told their monitors were quiet when in fact we could not look.
 *
 * After: only PostgREST 42703 (the ack columns' migration not applied yet) degrades, and it
 * degrades exactly once; every other fault throws so the page shows its error boundary.
 */

// incidents-server.ts is `server-only`; the marker package throws outside a React Server build.
vi.mock('server-only', () => ({}))

type Res = { data: unknown; error: unknown }

const UNDEFINED_COLUMN = { code: '42703', message: 'column alert_events.acknowledged_at does not exist' }
const RLS_DENIED = { code: '42501', message: 'permission denied for table alert_events' }

/** Queued outcomes for each `alert_events` select, drained in call order. */
let eventResults: Res[] = []
const selectedColumns: string[] = []

function eventsBuilder() {
  const b = {
    select: (columns: string) => {
      selectedColumns.push(columns)
      return b
    },
    eq: () => b,
    order: () => b,
    limit: () => Promise.resolve(eventResults.shift() ?? { data: [], error: null }),
  }
  return b
}

const supabase = {
  from: (table: string) => {
    if (table === 'alert_events') return eventsBuilder()
    // alerts lookups are irrelevant to these paths (they are only reached with rows in hand)
    return {
      select: () => ({
        in: () => ({ is: async () => ({ data: [], error: null }) }),
        eq: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

import { listIncidents } from './incidents-server'

beforeEach(() => {
  eventResults = []
  selectedColumns.length = 0
})

describe('listIncidents', () => {
  it('reads the ack columns and reports ackReady when they exist', async () => {
    eventResults = [{ data: [], error: null }]
    const res = await listIncidents(supabase, 'org1')
    expect(res).toEqual({ incidents: [], ackReady: true })
    expect(selectedColumns).toHaveLength(1)
    expect(selectedColumns[0]).toContain('acknowledged_at')
  })

  it('degrades to the base columns ONLY on 42703 (migration not applied)', async () => {
    eventResults = [
      { data: null, error: UNDEFINED_COLUMN },
      { data: [], error: null },
    ]
    const res = await listIncidents(supabase, 'org1')
    expect(res.ackReady).toBe(false) // → the UI hides the triage controls instead of 500-ing
    expect(selectedColumns).toHaveLength(2)
    expect(selectedColumns[1]).not.toContain('acknowledged_at')
  })

  it('THROWS on any other read error instead of reporting a false all-clear', async () => {
    eventResults = [{ data: null, error: RLS_DENIED }]
    await expect(listIncidents(supabase, 'org1')).rejects.toThrow(/permission denied/)
    expect(selectedColumns).toHaveLength(1) // no pointless retry either
  })

  it('THROWS when the base-column retry itself fails — the discarded error was the bug', async () => {
    eventResults = [
      { data: null, error: UNDEFINED_COLUMN },
      { data: null, error: { message: 'connection terminated unexpectedly' } },
    ]
    await expect(listIncidents(supabase, 'org1')).rejects.toThrow(/connection terminated/)
  })

  it('throws a real Error (it crosses a Server Component boundary), carrying the SQLSTATE', async () => {
    eventResults = [{ data: null, error: RLS_DENIED }]
    const err = await listIncidents(supabase, 'org1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as { code?: string }).code).toBe('42501')
  })
})
