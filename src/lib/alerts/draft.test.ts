import { describe, expect, it } from 'vitest'

import { buildMonitorDraftQuestion, parseMonitorDraft, validateMonitorProposal, type StashedQuery } from './draft'

const NOW = Date.parse('2026-09-27T05:00:00Z')
const sink = { goal: '가입이 꺾이면 알려줘', timezone: 'Asia/Seoul' }

function series(values: number[], lastDay = '2026-09-26'): StashedQuery {
  const end = Date.parse(`${lastDay}T00:00:00Z`)
  return {
    sql: 'select day, signups from …',
    columns: ['day', 'signups'],
    rows: values.map((v, i) => ({ day: new Date(end - (values.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), signups: v })),
  }
}
const base = Array.from({ length: 60 }, (_, i) => 50 + (i % 7) - 3)
const store = (q: StashedQuery) => new Map([['q1', q]])
const input = {
  queryId: 'q1',
  name: '일일 가입자 수',
  condition: { v: 1 as const, strategy: 'anomaly' as const, direction: 'down' as const, sensitivity: 3, window: 28 },
  rationale: 'profiles 테이블의 일별 신규 가입 수를 봅니다.',
}

describe('validateMonitorProposal', () => {
  it('binds the SQL from the stashed query and the goal from the HOST, not the model', () => {
    const r = validateMonitorProposal(store(series(base)), sink, input, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.draft.metricSql).toBe('select day, signups from …')
      expect(r.draft.goal).toBe(sink.goal)
      expect(r.draft.sample.rows).toHaveLength(60)
      expect(r.summary).toMatch(/would have fired 0 time/)
    }
  })

  it('rejects an unknown queryId with a self-repair hint', () => {
    const r = validateMonitorProposal(new Map(), sink, input, NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/execute_sql/)
  })

  it('passes the series-shape errors through (missing days)', () => {
    const q = series(base)
    q.rows.splice(5, 1)
    const r = validateMonitorProposal(store(q), sink, input, NOW)
    expect(r.ok).toBe(false)
  })

  it('tells the model when the rule is noisy so it can loosen it', () => {
    const noisy = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 5 : 50))
    const r = validateMonitorProposal(store(series(noisy)), sink, { ...input, condition: { ...input.condition, sensitivity: 1 } }, NOW)
    expect(r.ok && r.summary).toMatch(/noisy/)
  })

  it('caps the sample kept on the draft to the most recent rows', () => {
    const long = Array.from({ length: 400 }, (_, i) => 50 + (i % 7))
    const r = validateMonitorProposal(store(series(long)), sink, input, NOW)
    expect(r.ok && r.draft.sample.rows.length).toBe(200)
    expect(r.ok && (r.draft.sample.rows.at(-1) as { day: string }).day).toBe('2026-09-26')
  })
})

describe('draft helpers', () => {
  it('round-trips a persisted draft and rejects junk', () => {
    const r = validateMonitorProposal(store(series(base)), sink, input, NOW)
    expect(r.ok && parseMonitorDraft(JSON.parse(JSON.stringify(r.draft)))).toBeTruthy()
    expect(parseMonitorDraft({ name: 'x' })).toBeNull()
  })
  it('frames the goal verbatim as the user turn', () => {
    expect(buildMonitorDraftQuestion('tell me when "signups" dip')).toContain(`"tell me when 'signups' dip"`)
  })
})
