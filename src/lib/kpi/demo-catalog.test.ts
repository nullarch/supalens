import { describe, expect, it } from 'vitest'

import { KPI_CATEGORIES, KpiAlertConfig, KpiEvidence, KpiNoMonitor, ProposeKpiInput } from './types'
import { referencedColumns, VisualizationSpec } from '@/lib/viz/spec'
import { DEMO_KPI_PROPOSALS } from './demo-catalog'

describe('demo canned KPI catalog', () => {
  it('ships 8–10 proposals', () => {
    expect(DEMO_KPI_PROPOSALS.length).toBeGreaterThanOrEqual(8)
    expect(DEMO_KPI_PROPOSALS.length).toBeLessThanOrEqual(10)
  })

  it('every viz spec passes VisualizationSpec.safeParse', () => {
    for (const p of DEMO_KPI_PROPOSALS) {
      const res = VisualizationSpec.safeParse(p.vizSpec)
      expect(res.success ? 'ok' : `${p.key}: ${JSON.stringify(res.error.flatten())}`).toBe('ok')
    }
  })

  it('binds metric_sql to the viz spec query sql (the widget + alert re-run this SQL)', () => {
    for (const p of DEMO_KPI_PROPOSALS) {
      expect(p.metricSql, p.key).toBe(p.vizSpec.query.sql)
      expect(p.metricSql.trim().length, p.key).toBeGreaterThan(0)
    }
  })

  it('every chart references only columns present in its sample', () => {
    for (const p of DEMO_KPI_PROPOSALS) {
      const cols = new Set(p.vizSpec.sample?.columns ?? [])
      for (const c of referencedColumns(p.vizSpec.chart)) {
        expect(cols.has(c) ? 'ok' : `${p.key} references missing column ${c}`).toBe('ok')
      }
    }
  })

  it('every attached alert config parses (KpiAlertConfig)', () => {
    for (const p of DEMO_KPI_PROPOSALS) {
      if (!p.alertConfig) continue
      expect(KpiAlertConfig.safeParse(p.alertConfig).success, p.key).toBe(true)
    }
  })

  it('includes both a threshold and an anomaly alert', () => {
    const alerts = DEMO_KPI_PROPOSALS.map((p) => p.alertConfig).filter(Boolean)
    expect(alerts.some((a) => a?.type === 'threshold')).toBe(true)
    expect(alerts.some((a) => a?.type === 'anomaly')).toBe(true)
  })

  it('every demo KPI declares a monitor OR why it has none (the honest Monitor-all split)', () => {
    for (const p of DEMO_KPI_PROPOSALS) {
      const declared = Boolean(p.alertConfig) !== Boolean(p.noMonitor)
      expect(declared, `${p.key} must declare exactly one of alertConfig / noMonitor`).toBe(true)
      if (p.noMonitor) {
        expect(KpiNoMonitor.safeParse(p.noMonitor).success, p.key).toBe(true)
        expect(p.noMonitor.note, `${p.key} should explain itself`).toBeTruthy()
      }
    }
    // The demo must SHOW both sides, or the review page teaches the wrong lesson.
    expect(DEMO_KPI_PROPOSALS.some((p) => p.alertConfig)).toBe(true)
    expect(DEMO_KPI_PROPOSALS.some((p) => p.noMonitor)).toBe(true)
  })

  it('has unique, valid snake_case keys', () => {
    const keys = DEMO_KPI_PROPOSALS.map((p) => p.key)
    expect(new Set(keys).size, 'keys must be unique').toBe(keys.length)
    for (const k of keys) {
      expect(ProposeKpiInput.key.safeParse(k).success, k).toBe(true)
    }
  })

  it('uses valid categories, importance 1–5, and non-empty parseable evidence', () => {
    for (const p of DEMO_KPI_PROPOSALS) {
      expect(KPI_CATEGORIES as readonly string[]).toContain(p.category)
      expect(p.importance, p.key).toBeGreaterThanOrEqual(1)
      expect(p.importance, p.key).toBeLessThanOrEqual(5)
      expect(p.evidence.length, p.key).toBeGreaterThan(0)
      for (const e of p.evidence) {
        expect(KpiEvidence.safeParse(e).success, `${p.key} evidence`).toBe(true)
      }
    }
  })
})
