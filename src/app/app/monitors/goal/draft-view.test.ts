import { describe, expect, it } from 'vitest'

import { buildDraftPreview, draftStage, finalText, isIntegerSeries, latestDraft, readableBound, roundNice, switchStrategy, type DraftChunk } from './draft-view'
import type { MonitorCondition } from '@/lib/alerts/condition'

const NOW = Date.parse('2026-09-27T05:00:00Z')
const down: MonitorCondition = { v: 1, strategy: 'anomaly', direction: 'down', sensitivity: 3, window: 28 }

function sample(values: number[], lastDay = '2026-09-26') {
  const end = Date.parse(`${lastDay}T00:00:00Z`)
  return {
    columns: ['day', 'n'],
    rows: values.map((v, i) => ({ day: new Date(end - (values.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), n: v })),
  }
}
const draft = (values: number[]) => ({
  name: 'Daily signups',
  goal: 'tell me when signups dip',
  metricSql: 'select …',
  condition: down,
  rationale: 'r',
  sample: sample(values),
})
const base = Array.from({ length: 40 }, (_, i) => 50 + (i % 5) - 2)

describe('draftStage', () => {
  it('advances monotonically through schema → query → propose', () => {
    const chunks: DraftChunk[] = [
      { type: 'tool_use', tool: 'mcp__supalens__get_schema' },
      { type: 'tool_use', tool: 'mcp__supalens__execute_sql' },
      { type: 'tool_use', tool: 'mcp__supalens__get_schema' },
    ]
    expect(draftStage([])).toBe('start')
    expect(draftStage(chunks)).toBe('query')
    expect(draftStage([...chunks, { type: 'tool_use', tool: 'mcp__supalens__propose_monitor' }])).toBe('propose')
  })
})

describe('latestDraft / finalText', () => {
  it('takes the last valid draft and ignores malformed ones', () => {
    const a = draft(base)
    const b = { ...draft(base), name: 'Second' }
    expect(latestDraft([{ type: 'monitor_draft', draft: a }, { type: 'monitor_draft', draft: b }])?.name).toBe('Second')
    expect(latestDraft([{ type: 'monitor_draft', draft: { nope: 1 } }])).toBeNull()
  })
  it('joins the streamed prose', () => {
    expect(finalText([{ type: 'text', text: 'No ' }, { type: 'status', status: 'done' }, { type: 'text', text: 'signups table.' }])).toBe('No signups table.')
  })
})

describe('buildDraftPreview', () => {
  it('computes bands, the current verdict and the backtest from the draft sample', () => {
    const p = buildDraftPreview(draft([...base, 10]), down, NOW, 'UTC')
    expect(p).not.toBeNull()
    if (!p) return
    expect(p.points).toHaveLength(41)
    // the first days have no baseline yet
    expect(p.bands[0]).toBeNull()
    expect(p.bands.at(-1)?.lower).toBeGreaterThan(10)
    expect(p.current.met).toBe(true)
    expect(p.firedBuckets).toEqual(['2026-09-26'])
  })
  it('re-evaluates when the operator loosens the rule (slider)', () => {
    const tight = buildDraftPreview(draft([...base, 38]), { ...down, sensitivity: 1.5 }, NOW, 'UTC')
    const loose = buildDraftPreview(draft([...base, 38]), { ...down, sensitivity: 5 }, NOW, 'UTC')
    expect(tight?.current.met).toBe(true)
    expect(loose?.current.met).toBe(false)
  })
})

describe('switchStrategy', () => {
  it('seeds an absolute threshold from the usual range, rounded', () => {
    const p = buildDraftPreview(draft(base), down, NOW, 'UTC')
    const abs = switchStrategy(down, 'absolute', p?.current ?? null)
    expect(abs.strategy).toBe('absolute')
    if (abs.strategy === 'absolute') {
      expect(abs.operator).toBe('lt')
      expect(abs.threshold).toBe(roundNice(p?.current.lower ?? 0))
    }
  })
  it('keeps the direction across strategies', () => {
    const up: MonitorCondition = { ...down, direction: 'up' }
    const rel = switchStrategy(up, 'relative', null)
    expect(rel.strategy === 'relative' && rel.direction).toBe('up')
  })
  it('rounds to two significant digits', () => {
    expect(roundNice(46.37)).toBe(46)
    expect(roundNice(1234)).toBe(1200)
    expect(roundNice(0.0567)).toBeCloseTo(0.057)
  })
})

describe('readableBound', () => {
  it('shows the exact integer edge for counts', () => {
    // integers below 25.42 are 25 and less = "below 26"
    expect(readableBound(25.42, 'lower', true)).toBe(26)
    // integers above 71.8 are 72 and more = "above 71"
    expect(readableBound(71.8, 'upper', true)).toBe(71)
    expect(readableBound(25.42, 'lower', false)).toBe(25.42)
    // an exact integer edge fires too: lower 25 → 25 alerts → "below 26"
    expect(readableBound(25, 'lower', true)).toBe(26)
    expect(readableBound(72, 'upper', true)).toBe(71)
    expect(isIntegerSeries([{ bucket: null, value: 3 }, { bucket: null, value: 4 }])).toBe(true)
    expect(isIntegerSeries([{ bucket: null, value: 3.5 }])).toBe(false)
  })
})
