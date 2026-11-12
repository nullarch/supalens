import { describe, expect, it } from 'vitest'

import {
  INITIAL_PROGRESS,
  MAX_ITEMS_PER_METRIC,
  bootstrapDurationMs,
  isTerminal,
  nextPhaseToRun,
  reduceAll,
  reduceBootstrap,
  type BootstrapEvent,
} from './events'

const ev = (e: Partial<BootstrapEvent> & Pick<BootstrapEvent, 'phase' | 'kind'>): BootstrapEvent => ({
  type: 'bootstrap',
  at: 1_000,
  ...e,
})

describe('reduceBootstrap', () => {
  it('starts every counter at null — an unmeasured count is never 0', () => {
    expect(INITIAL_PROGRESS.counts).toEqual({ tables: null, entities: null, rules: null, kpis: null })
    const s = reduceBootstrap(INITIAL_PROGRESS, ev({ phase: 'schema', kind: 'phase_start' }))
    expect(s.counts.tables).toBeNull()
    expect(s.phases.schema).toBe('running')
  })

  it('records the first phase_start as the scan start and the kpi phase_done as the end', () => {
    const s = reduceAll([
      ev({ phase: 'schema', kind: 'phase_start', at: 100 }),
      ev({ phase: 'context', kind: 'phase_start', at: 500 }),
      ev({ phase: 'kpi', kind: 'phase_done', metric: 'kpis', count: 7, at: 900 }),
    ])
    expect(s.startedAt).toBe(100)
    expect(s.finishedAt).toBe(900)
    expect(bootstrapDurationMs(s)).toBe(800)
  })

  it('takes end-of-phase counts from phase_done (entities/rules are only knowable then)', () => {
    const s = reduceAll([
      ev({ phase: 'context', kind: 'phase_start' }),
      ev({ phase: 'context', kind: 'count', metric: 'entities', count: 6 }),
      ev({ phase: 'context', kind: 'phase_done', metric: 'rules', count: 9 }),
    ])
    expect(s.counts.entities).toBe(6)
    expect(s.counts.rules).toBe(9)
    expect(s.phases.context).toBe('done')
  })

  it('counts incremental items and caps the revealed name list', () => {
    const events = Array.from({ length: MAX_ITEMS_PER_METRIC + 5 }, (_, i) =>
      ev({ phase: 'kpi', kind: 'item', metric: 'kpis', label: `kpi-${i}` }),
    )
    const s = reduceAll(events)
    expect(s.counts.kpis).toBe(MAX_ITEMS_PER_METRIC + 5) // the counter keeps climbing
    expect(s.items.kpis).toHaveLength(MAX_ITEMS_PER_METRIC) // the list does not
    expect(s.items.kpis[0]).toBe('kpi-0')
  })

  it('a failure stamps the error and stops the clock', () => {
    const s = reduceAll([
      ev({ phase: 'schema', kind: 'phase_start', at: 10 }),
      ev({ phase: 'context', kind: 'phase_failed', error: 'clone failed', at: 60 }),
    ])
    expect(s.phases.context).toBe('failed')
    expect(s.error).toBe('clone failed')
    expect(bootstrapDurationMs(s)).toBe(50)
    expect(isTerminal(s)).toBe(true)
  })

  it('ignores foreign frames on the shared stream', () => {
    const s = reduceBootstrap(INITIAL_PROGRESS, { type: 'text', phase: 'schema', kind: 'phase_start', at: 1 } as unknown as BootstrapEvent)
    expect(s).toBe(INITIAL_PROGRESS)
  })
})

describe('nextPhaseToRun (retry resumes from the last success)', () => {
  it('runs everything from scratch on a fresh state', () => {
    expect(nextPhaseToRun(INITIAL_PROGRESS)).toBe('schema')
  })

  it('skips finished phases — a failed KPI half retries only the KPI half', () => {
    const s = reduceAll([
      ev({ phase: 'schema', kind: 'phase_done', metric: 'tables', count: 42 }),
      ev({ phase: 'context', kind: 'phase_done', metric: 'entities', count: 6 }),
      ev({ phase: 'kpi', kind: 'phase_failed', error: 'agent error' }),
    ])
    expect(nextPhaseToRun(s)).toBe('kpi')
  })

  it('treats an explicitly skipped phase as finished', () => {
    const s = reduceAll([
      ev({ phase: 'schema', kind: 'phase_skipped' }),
      ev({ phase: 'context', kind: 'phase_skipped' }),
    ])
    expect(nextPhaseToRun(s)).toBe('kpi')
  })

  it('returns null when the whole scan is done', () => {
    const s = reduceAll([
      ev({ phase: 'schema', kind: 'phase_done' }),
      ev({ phase: 'context', kind: 'phase_done' }),
      ev({ phase: 'kpi', kind: 'phase_done' }),
    ])
    expect(nextPhaseToRun(s)).toBeNull()
    expect(isTerminal(s)).toBe(true)
  })
})
