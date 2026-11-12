import { describe, expect, it, vi } from 'vitest'
import * as runChannel from '@/lib/agent/run-channel'
import { loadRoute } from './route-harness.test-helper'

type Row = { id: string; channel: string | null; user_id: string | null }
type Result = { data: Row[] | null; error?: { code: string } }
type View = { type: string; props: { rows: Row[]; page: number; hasNext: boolean; channelAvailable: boolean; filtered: boolean; loadError: boolean; incidentByRun: Record<string, string> } }

function history(results: Result[], signedIn = true) {
  const calls: unknown[][] = []
  let read = 0
  const client = {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'user-a' } : null } }) },
    from: vi.fn((table: string) => {
      calls.push(['from', table])
      const query = {
        select: (value: string) => { calls.push(['select', value]); return query },
        order: (value: string, options: unknown) => { calls.push(['order', value, options]); return query },
        eq: (key: string, value: string) => { calls.push(['eq', key, value]); return query },
        range: async (start: number, end: number) => { calls.push(['range', start, end]); return results[read++] },
        in: async (key: string, ids: string[]) => {
          calls.push(['in', key, ids])
          return { data: ids.map(id => ({ id: `incident-${id}`, explanation_run_id: id })) }
        },
      }
      return query
    }),
  }
  const page = loadRoute('app/ask/history/page.tsx', {
    'next/navigation': { redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) } },
    'next-intl/server': { getTranslations: async () => (key: string) => key },
    '@/utils/supabase/server': { createClient: async () => client },
    '@/lib/agent/run-channel': runChannel,
    '@/components/agent/HistoryView': { HistoryView: 'HistoryView' },
  })
  return { calls, client, render: async (params = {}) => await page.default({ searchParams: Promise.resolve(params) }) as View }
}

describe('actual history page preserves loading/filter/pagination contracts', () => {
  it('passes 50 rows and the lookahead flag, querying incidents only for displayed investigation rows', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ id: `run-${index}`, channel: 'incident', user_id: null }))
    const f = history([{ data: rows }]), view = await f.render({ page: '2', origin: 'incident' })
    expect(view.type).toBe('HistoryView')
    expect(view.props).toMatchObject({ page: 2, hasNext: true, filtered: true, channelAvailable: true, loadError: false })
    expect(view.props.rows).toEqual(rows.slice(0, 50))
    expect(f.calls).toContainEqual(['range', 50, 100])
    expect(f.calls).toContainEqual(['eq', 'channel', 'incident'])
    expect(f.calls).toContainEqual(['in', 'explanation_run_id', rows.slice(0, 50).map(row => row.id)])
    expect(view.props.incidentByRun['run-49']).toBe('incident-run-49')
    expect(view.props.incidentByRun['run-50']).toBeUndefined()
  })
  it('keeps the pre-migration fallback unfiltered and infers web/Slack without false incident links', async () => {
    const f = history([{ data: null, error: { code: '42703' } }, { data: [
      { id: 'run-web', user_id: 'user-a', channel: null }, { id: 'run-slack', user_id: null, channel: null },
    ] }]), view = await f.render({ origin: 'incident' })
    expect(view.props).toMatchObject({ channelAvailable: false, filtered: false, loadError: false, incidentByRun: {} })
    expect(view.props.rows.map(row => row.channel)).toEqual(['web', 'slack'])
    expect(f.calls.filter(call => call[0] === 'select')).toEqual([
      ['select', 'id, question, status, created_at, ended_at, user_id, data_source_id, data_sources(name), channel'],
      ['select', 'id, question, status, created_at, ended_at, user_id, data_source_id, data_sources(name)'],
    ])
    expect(f.client.from).toHaveBeenCalledTimes(2)
  })
  for (const results of [
    [{ data: null, error: { code: '42501' } }],
    [{ data: null, error: { code: '42703' } }, { data: null, error: { code: '42501' } }],
  ]) {
    it(`passes an explicit failed-read flag after ${results.length} local reads`, async () => {
      const f = history(results), view = await f.render()
      expect(view.props).toMatchObject({ rows: [], loadError: true, hasNext: false })
      expect(f.client.from).toHaveBeenCalledTimes(results.length)
    })
  }
  it('successful empty data is not a failure and invalid page values remain page one', async () => {
    const f = history([{ data: [] }]), view = await f.render({ page: '-4', origin: 'unknown' })
    expect(view.props).toMatchObject({ rows: [], page: 1, loadError: false, hasNext: false, filtered: false })
    expect(f.calls).toContainEqual(['range', 0, 50])
    expect(f.client.from).toHaveBeenCalledTimes(1)
  })
  it('redirects before listing history for an anonymous user', async () => {
    const f = history([], false)
    await expect(f.render()).rejects.toThrow('REDIRECT:/login?next=/app/ask/history')
    expect(f.client.from).not.toHaveBeenCalled()
  })
})
