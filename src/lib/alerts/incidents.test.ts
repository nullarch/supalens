import { describe, expect, it } from 'vitest'

import {
  INVESTIGATING_WINDOW_MS,
  changePercent,
  deriveIncidents,
  deriveSeverity,
  durationParts,
  extractSegments,
  firstSentence,
  followUpQuestion,
  incidentStatus,
  parseZScore,
  splitExplanation,
  type IncidentAlertRow,
  type IncidentEventRow,
} from './incidents'

const NOW = Date.parse('2026-09-04T12:00:00Z')
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString()

const threshold: IncidentAlertRow = { id: 'a1', name: 'Daily revenue', type: 'threshold', operator: 'lt', threshold: 1000, sensitivity: null, fire_threshold: 2 }
const anomaly: IncidentAlertRow = { id: 'a2', name: 'Signups', type: 'anomaly', operator: 'gt', threshold: 0, sensitivity: 3 }
const alerts = new Map([
  [threshold.id, threshold],
  [anomaly.id, anomaly],
])

function ev(over: Partial<IncidentEventRow> & Pick<IncidentEventRow, 'id' | 'alert_id' | 'kind' | 'created_at'>): IncidentEventRow {
  return { value: null, message: null, explanation: null, explained: false, notified: false, ...over }
}

describe('severity / change', () => {
  it('threshold monitors grade by relative distance from the threshold', () => {
    expect(deriveSeverity(threshold, 400, null)).toBe('high') // 60% below
    expect(deriveSeverity(threshold, 750, null)).toBe('medium') // 25%
    expect(deriveSeverity(threshold, 950, null)).toBe('low') // 5%
    expect(deriveSeverity(threshold, null, null)).toBe('medium')
  })
  it('a zero-tolerance threshold (0) firing is high', () => {
    expect(deriveSeverity({ type: 'threshold', threshold: 0 }, 3, null)).toBe('high')
  })
  it('anomaly monitors grade by the z-score in the message, medium when absent', () => {
    expect(deriveSeverity(anomaly, 10, '현재 값 10이(가) 평소 범위를 크게 벗어났습니다 (평소 평균 40 대비 7.1σ 이탈).')).toBe('high')
    expect(deriveSeverity(anomaly, 10, '… 4.2σ …')).toBe('medium')
    expect(deriveSeverity(anomaly, 10, '… 3.1σ …')).toBe('low')
    expect(deriveSeverity(anomaly, 10, '… ∞σ …')).toBe('high')
    expect(deriveSeverity(anomaly, 10, 'no sigma here')).toBe('medium')
  })
  it('parseZScore handles decimals, commas and infinity', () => {
    expect(parseZScore('3.4σ')).toBe(3.4)
    expect(parseZScore('3,4σ')).toBe(3.4)
    expect(parseZScore('∞σ')).toBe(Number.POSITIVE_INFINITY)
    expect(parseZScore(null)).toBeNull()
  })
  it('changePercent is relative to the threshold and null for anomaly / zero threshold', () => {
    expect(changePercent(threshold, 750)).toBeCloseTo(-25)
    expect(changePercent(anomaly, 10)).toBeNull()
    expect(changePercent({ type: 'threshold', threshold: 0 }, 5)).toBeNull()
  })
})

describe('status + pairing', () => {
  it('investigating only while young and unexplained; open once explained or old', () => {
    expect(incidentStatus({ created_at: iso(2), explanation: null, explained: false }, null, NOW)).toBe('investigating')
    expect(incidentStatus({ created_at: iso(2), explanation: 'x', explained: true }, null, NOW)).toBe('open')
    expect(incidentStatus({ created_at: iso(2), explanation: null, explained: true }, null, NOW)).toBe('open') // agent failed
    const old = new Date(NOW - INVESTIGATING_WINDOW_MS - 1000).toISOString()
    expect(incidentStatus({ created_at: old, explanation: null, explained: false }, null, NOW)).toBe('open')
    expect(incidentStatus({ created_at: iso(2), explanation: null, explained: false }, iso(1), NOW)).toBe('resolved')
  })

  it('pairs each fired event with the next resolved of the SAME monitor and never crosses a later fire', () => {
    const events: IncidentEventRow[] = [
      ev({ id: 'f1', alert_id: 'a1', kind: 'fired', created_at: iso(300), value: 400, explanation: 'e1', explained: true }),
      ev({ id: 'r1', alert_id: 'a1', kind: 'resolved', created_at: iso(240), value: 1200 }),
      ev({ id: 'f2', alert_id: 'a1', kind: 'fired', created_at: iso(120), value: 700, explanation: null, explained: true }),
      ev({ id: 'f3', alert_id: 'a2', kind: 'fired', created_at: iso(3), value: 10, message: '5.5σ' }),
      ev({ id: 'r9', alert_id: 'a2', kind: 'resolved', created_at: iso(400), value: 1 }), // older resolve — must not pair
    ]
    const inc = deriveIncidents(events, alerts, NOW)
    expect(inc.map((i) => i.id)).toEqual(['f3', 'f2', 'f1']) // newest first
    const f1 = inc.find((i) => i.id === 'f1')!
    expect(f1.status).toBe('resolved')
    expect(f1.resolvedAt).toBe(iso(240))
    expect(f1.resolvedValue).toBe(1200)
    expect(f1.durationMs).toBe(60 * 60_000)
    expect(f1.severity).toBe('high')
    expect(f1.changePct).toBeCloseTo(-60)
    expect(f1.fireThreshold).toBe(2)
    const f2 = inc.find((i) => i.id === 'f2')!
    expect(f2.status).toBe('open')
    expect(f2.resolvedAt).toBeNull()
    expect(f2.durationMs).toBe(120 * 60_000)
    const f3 = inc.find((i) => i.id === 'f3')!
    expect(f3.status).toBe('investigating')
    expect(f3.alertType).toBe('anomaly')
    expect(f3.threshold).toBeNull()
    expect(f3.zScore).toBe(5.5)
    expect(f3.severity).toBe('medium')
    expect(f3.resolvedAt).toBeNull() // r9 predates the fire
  })

  it('skips events whose monitor is not visible, and reads optional ack/feedback columns', () => {
    const events: IncidentEventRow[] = [
      ev({ id: 'x', alert_id: 'ghost', kind: 'fired', created_at: iso(5) }),
      ev({
        id: 'f',
        alert_id: 'a1',
        kind: 'fired',
        created_at: iso(5),
        acknowledged_at: iso(4),
        acknowledged_by: 'u1',
        ack_kind: 'expected',
        cause_feedback: 'partial',
        cause_correction: 'it was the promo',
      }),
    ]
    const inc = deriveIncidents(events, alerts, NOW)
    expect(inc).toHaveLength(1)
    expect(inc[0].ack).toEqual({ at: iso(4), by: 'u1', kind: 'expected' })
    expect(inc[0].feedback).toEqual({ value: 'partial', correction: 'it was the promo' })
    // pre-migration rows (no ack columns at all) → null, never a crash
    expect(deriveIncidents([ev({ id: 'g', alert_id: 'a1', kind: 'fired', created_at: iso(1) })], alerts, NOW)[0].ack).toBeNull()
  })
})

describe('explanation helpers', () => {
  it('firstSentence trims to the first sentence and caps length', () => {
    expect(firstSentence('Renewal revenue fell 31%. Japan drove most of it.')).toBe('Renewal revenue fell 31%.')
    expect(firstSentence('갱신 매출이 31% 줄었습니다. 일본이 대부분입니다.')).toBe('갱신 매출이 31% 줄었습니다.')
    expect(firstSentence('x'.repeat(200))!.length).toBe(140)
    expect(firstSentence(null)).toBeNull()
  })

  it('splitExplanation separates confirmed facts from the hypothesis only when markers exist', () => {
    const text = ['데이터에서 확인됨:', '- 갱신 매출 −31%', '- 일본 −52%', '', '가능성 높은 원인:', '결제 웹훅 실패율이 0.3%→7.8%로 올랐습니다.'].join('\n')
    const s = splitExplanation(text)
    expect(s.confirmed).toBe('갱신 매출 −31%\n일본 −52%')
    expect(s.likely).toBe('결제 웹훅 실패율이 0.3%→7.8%로 올랐습니다.')
    const en = splitExplanation('Renewals fell 31%, Japan −52%.\nLikely cause: webhook failures rose to 7.8%.')
    expect(en.confirmed).toBe('Renewals fell 31%, Japan −52%.')
    expect(en.likely).toBe('webhook failures rose to 7.8%.')
    expect(splitExplanation('Plain prose with no markers at all.')).toEqual({ confirmed: null, likely: null })
    expect(splitExplanation(null)).toEqual({ confirmed: null, likely: null })
  })

  it('extractSegments needs at least two "name: value" lines', () => {
    expect(extractSegments('US: normal\nJapan: −52%\nNew subscriptions: -4%')).toEqual([
      { name: 'US', value: 'normal' },
      { name: 'Japan', value: '−52%' },
      { name: 'New subscriptions', value: '-4%' },
    ])
    expect(extractSegments('Note: revenue dropped 20% overall.')).toEqual([])
  })

  it('followUpQuestion is locale-aware and names the monitor + time', () => {
    const q = followUpQuestion({ alertName: 'MRR', firedAt: '2026-09-04T11:30:00.000Z' }, 'ko')
    expect(q).toContain('MRR')
    expect(q).toContain('2026-09-04 11:30')
    expect(followUpQuestion({ alertName: 'MRR', firedAt: '2026-09-04T11:30:00.000Z' }, 'en')).toMatch(/^Explain/)
  })

  it('followUpQuestion states the time in the ORG zone and labels the offset it used', () => {
    const inc = { alertName: 'MRR', firedAt: '2026-09-04T11:30:00.000Z' }
    // 11:30 UTC is 20:30 in Seoul — the analyst must be asked about the clock they read on screen.
    const seoul = followUpQuestion(inc, 'en', 'Asia/Seoul')
    expect(seoul).toContain('2026-09-04 20:30')
    expect(seoul).toContain('UTC+09:00')
    expect(seoul).not.toContain('11:30')
    // no zone given → UTC, and the label says so rather than staying silent
    expect(followUpQuestion(inc, 'en')).toContain('11:30 UTC')
    // an unknown zone must not throw or emit a bare offset-less time
    expect(followUpQuestion(inc, 'ko', 'Asia/Atlantis')).toContain('(UTC)')
  })
})

describe('durationParts', () => {
  it('steps minute → hour → day and never goes negative', () => {
    expect(durationParts(30_000)).toEqual({ unit: 'lessThanMinute', n: 0 })
    expect(durationParts(-5)).toEqual({ unit: 'lessThanMinute', n: 0 })
    expect(durationParts(9 * 60_000)).toEqual({ unit: 'minutes', n: 9 })
    expect(durationParts(59 * 60_000)).toEqual({ unit: 'minutes', n: 59 })
    expect(durationParts(60 * 60_000)).toEqual({ unit: 'hours', n: 1 })
    expect(durationParts(23.5 * 3_600_000)).toEqual({ unit: 'hours', n: 23 })
    expect(durationParts(50 * 3_600_000)).toEqual({ unit: 'days', n: 2 })
  })
})
