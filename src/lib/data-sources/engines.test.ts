import { describe, expect, it } from 'vitest'

import { isDocumentEngine, isSqlEngine, SQL_ENGINES } from './engines'
import { taskIdForEngine } from '@/lib/agent/engine'
import { buildDefaultTableSpec, withoutSample, type VisualizationSpec } from '@/lib/viz/spec'

describe('engine family whitelist', () => {
  it('classifies the known engines', () => {
    expect(isSqlEngine('postgres')).toBe(true)
    expect(isSqlEngine('mysql')).toBe(true)
    expect(isSqlEngine('firestore')).toBe(false)
    expect(isDocumentEngine('firestore')).toBe(true)
    expect(isDocumentEngine('postgres')).toBe(false)
  })

  it('rejects unknown / missing engines (whitelist, not blacklist)', () => {
    for (const v of ['bigquery', 'mongodb', '', null, undefined]) {
      expect(isSqlEngine(v)).toBe(false)
      expect(isDocumentEngine(v)).toBe(false)
    }
  })

  it('SQL_ENGINES stays in sync with the guard', () => {
    for (const e of SQL_ENGINES) expect(isSqlEngine(e)).toBe(true)
  })
})

describe('taskIdForEngine (engine → Trigger task dispatch)', () => {
  it('routes each family to its task', () => {
    expect(taskIdForEngine('postgres')).toBe('analyze')
    expect(taskIdForEngine('mysql')).toBe('analyze')
    expect(taskIdForEngine('firestore')).toBe('analyze-firestore')
  })

  it('keeps null/undefined on the SQL task (legacy rows / demo sources)', () => {
    expect(taskIdForEngine(null)).toBe('analyze')
    expect(taskIdForEngine(undefined)).toBe('analyze')
  })

  it('THROWS on an unregistered engine instead of silently running the SQL path', () => {
    expect(() => taskIdForEngine('bigquery')).toThrow(/no analysis task/)
  })
})

describe('viz spec helpers touched by the engine seam', () => {
  it('buildDefaultTableSpec carries the firestore re-run descriptor when given', () => {
    const fs = { collection: 'orders', limit: 100 }
    const spec = buildDefaultTableSpec(['a', 'b'], 'firestore: orders', fs)
    expect(spec.query.firestore).toEqual(fs)
    expect(spec.query.sql).toBe('firestore: orders')
    // and omits the key entirely for SQL results
    expect(buildDefaultTableSpec(['a'], 'select 1').query.firestore).toBeUndefined()
  })

  it('buildDefaultTableSpec embeds the rows as a bounded sample so the fallback table RENDERS', () => {
    // Regression: the fallback synthesized when the model proposes no chart had no `sample`, so the
    // "always render something" widget parsed to empty (data ?? sample === undefined) in ask/share.
    const rows = Array.from({ length: 250 }, (_, i) => ({ a: i, b: `r${i}` }))
    const spec = buildDefaultTableSpec(['a', 'b'], 'select 1', undefined, rows)
    expect(spec.sample?.columns).toEqual(['a', 'b'])
    expect(spec.sample?.rows).toHaveLength(200) // capped at 200
    // no rows → no sample key (nothing to render)
    expect(buildDefaultTableSpec(['a'], 'select 1', undefined, []).sample).toBeUndefined()
    expect(buildDefaultTableSpec(['a'], 'select 1').sample).toBeUndefined()
  })

  it('withoutSample strips only the inline sample', () => {
    const spec: VisualizationSpec = {
      v: 1,
      query: { sql: 'select 1' },
      sample: { columns: ['n'], rows: [{ n: 1 }] },
      chart: { type: 'table', title: 't', columns: [{ key: 'n' }] },
    }
    const stripped = withoutSample(spec)
    expect(stripped.sample).toBeUndefined()
    expect(stripped.query).toEqual(spec.query)
    expect(stripped.chart).toEqual(spec.chart)
    // no-op (same reference) when there is no sample
    expect(withoutSample(stripped)).toBe(stripped)
  })
})
