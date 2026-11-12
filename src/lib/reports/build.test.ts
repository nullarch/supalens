import { describe, expect, it } from 'vitest'

import type { Incident } from '@/lib/alerts/incidents'
import { actionReports, buildReports, localDay, localWeek, type ReportInputs, type ReportService } from './build'

// Thursday 2026-09-17 12:00 in Seoul.
const NOW = Date.parse('2026-09-17T03:00:00Z')
const TZ = 'Asia/Seoul'
const iso = (s: string) => new Date(s).toISOString()

const service = (over: Partial<ReportService> = {}): ReportService => ({
  id: 'svc-a', name: 'Production', stage: 'operating', board: 'normal', recovery: null,
  monitorCount: 2, monitorTotal: 2, erroredCount: 0, brokenCount: 0, pendingCount: 0,
  kpiHref: '/app/sources/svc-a/kpis', reconnectHref: '/api/connect-supabase/authorize', ...over,
})

const incident = (over: Partial<Incident & { dataSourceId: string | null }> = {}): Incident & { dataSourceId: string | null } => ({
  id: 'event-a', alertId: 'alert-a', alertName: 'Daily revenue', alertType: 'threshold', dataSourceName: 'Production',
  dataSourceId: 'svc-a', status: 'open', severity: 'high', value: 3_120_000, threshold: 4_000_000, operator: 'lt',
  changePct: -22, zScore: null, fireThreshold: 1, firedAt: iso('2026-09-17T01:00:00Z'), resolvedAt: null, resolvedValue: null,
  durationMs: 2 * 3_600_000, message: null, explanation: null, explained: false, notified: true, ack: null, feedback: null, ...over,
})

const inputs = (over: Partial<ReportInputs> = {}): ReportInputs => ({
  now: NOW, timeZone: TZ, services: [service()], incidents: [], extractions: [], contexts: [],
  monitoringSince: null, ...over,
})

describe('calendar helpers', () => {
  it('local days follow the org time zone, not UTC', () => {
    // 15:30Z on the 16th is 00:30 on the 17th in Seoul.
    expect(localDay(Date.parse('2026-09-16T15:30:00Z'), TZ).key).toBe('2026-09-17')
    expect(localDay(Date.parse('2026-09-16T15:30:00Z'), 'UTC').key).toBe('2026-09-16')
    const day = localDay(NOW, TZ)
    expect(new Date(day.start).toISOString()).toBe('2026-09-16T15:00:00.000Z')
    expect(day.end - day.start).toBe(86_400_000)
  })

  it('weeks start on Monday', () => {
    const week = localWeek(NOW, TZ)
    expect(week.key).toBe('2026-09-14')
    expect(week.end - week.start).toBe(7 * 86_400_000)
  })
})

describe('buildReports', () => {
  it('an open incident is an urgent report whose importance follows its severity', () => {
    for (const [severity, importance] of [['high', 'critical'], ['medium', 'high'], ['low', 'normal']] as const) {
      const [report] = buildReports(inputs({ incidents: [incident({ severity })] })).filter((r) => r.kind === 'incident')
      expect(report).toMatchObject({ id: 'incident:event-a', type: 'urgent', importance, needsAction: true, incidentId: 'event-a', href: '/app/incidents/event-a' })
    }
  })

  it('acknowledging an incident takes it off the action shelf but keeps the report', () => {
    const reports = buildReports(inputs({ incidents: [incident({ ack: { at: iso('2026-09-17T02:00:00Z'), by: 'user-a', kind: 'ack' } })] }))
    const report = reports.find((r) => r.kind === 'incident')!
    expect(report.needsAction).toBe(false)
    expect(report.ack).toEqual({ at: iso('2026-09-17T02:00:00Z'), kind: 'ack' })
    expect(actionReports(reports).map((r) => r.id)).not.toContain('incident:event-a')
  })

  it('the AI investigation is split into fact and hypothesis and tagged', () => {
    const explanation = 'Confirmed:\nRenewal revenue fell 31%.\nLikely cause:\nWebhook failures rose to 7.8%.'
    const report = buildReports(inputs({ incidents: [incident({ explanation, explained: true })] })).find((r) => r.kind === 'incident')!
    expect(report.findings).toEqual({ confirmed: 'Renewal revenue fell 31%.', likely: 'Webhook failures rose to 7.8%.', investigating: false })
    expect(report.tags).toContainEqual({ kind: 'ai' })
    expect(report.tags).toContainEqual({ kind: 'metric', label: 'Daily revenue' })
    expect(report.tags).toContainEqual({ kind: 'service', label: 'Production' })
  })

  it('a recovery is a low-importance follow-up for a week, then leaves the feed', () => {
    const recent = incident({ status: 'resolved', resolvedAt: iso('2026-09-16T01:00:00Z'), resolvedValue: 4_200_000 })
    const old = incident({ id: 'event-old', status: 'resolved', firedAt: iso('2026-09-01T00:00:00Z'), resolvedAt: iso('2026-09-02T00:00:00Z') })
    const reports = buildReports(inputs({ incidents: [recent, old] }))
    expect(reports.find((r) => r.id === 'resolved:event-a')).toMatchObject({ type: 'resolved', importance: 'low', needsAction: false })
    expect(reports.find((r) => r.id.includes('event-old'))).toBeUndefined()
    expect(reports.some((r) => r.kind === 'incident')).toBe(false)
  })

  it('service state becomes live status reports with the right urgency', () => {
    const reports = buildReports(inputs({
      services: [
        service({ id: 'broken', name: 'Billing', board: 'degraded', recovery: 'reconnect', erroredCount: 2, brokenCount: 2 }),
        service({ id: 'failing', name: 'Warehouse', board: 'degraded', erroredCount: 1 }),
        service({ id: 'off', name: 'Legacy', stage: 'paused', monitorCount: 0, monitorTotal: 3 }),
        service({ id: 'scan', name: 'Events', stage: 'analyzing', monitorCount: 0, monitorTotal: 0 }),
        service({ id: 'first', name: 'Support', stage: 'first_check', board: 'pending' }),
      ],
    }))
    const byKind = (kind: string) => reports.filter((r) => r.kind === kind)
    expect(byKind('connection')).toEqual([expect.objectContaining({ importance: 'critical', needsAction: true, live: true, params: { service: 'Billing', count: 2 } })])
    // A broken connection already explains the failing checks — no second degraded report for it.
    expect(byKind('degraded').map((r) => r.service?.id)).toEqual(['failing'])
    expect(byKind('paused')).toEqual([expect.objectContaining({ importance: 'high', needsAction: true })])
    expect(byKind('analyzing')).toEqual([expect.objectContaining({ importance: 'normal', needsAction: false })])
    expect(byKind('firstCheck')).toEqual([expect.objectContaining({ importance: 'low', needsAction: false })])
  })

  it('analysis reports: proposals waiting, a failed or missing extraction, a fresh business model', () => {
    const reports = buildReports(inputs({
      services: [
        service({ id: 'ready', stage: 'proposals', monitorCount: 0, monitorTotal: 0, pendingCount: 21 }),
        service({ id: 'failed', stage: 'extract', monitorCount: 0, monitorTotal: 0 }),
        service({ id: 'none', stage: 'extract', monitorCount: 0, monitorTotal: 0 }),
      ],
      extractions: [
        { dataSourceId: 'ready', status: 'completed', createdAt: iso('2026-09-17T00:00:00Z'), completedAt: iso('2026-09-17T00:10:00Z'), proposedCount: 21 },
        { dataSourceId: 'failed', status: 'failed', createdAt: iso('2026-09-16T00:00:00Z'), completedAt: null, proposedCount: null },
      ],
      contexts: [
        { dataSourceId: 'ready', status: 'fresh', generatedAt: iso('2026-09-16T23:00:00Z'), fromRepo: true },
        { dataSourceId: 'none', status: 'fresh', generatedAt: iso('2026-07-01T00:00:00Z'), fromRepo: false },
      ],
    }))
    expect(reports.find((r) => r.kind === 'kpiReady')).toMatchObject({ service: { id: 'ready' }, importance: 'high', needsAction: true, live: false, at: iso('2026-09-17T00:10:00Z'), params: { count: 21 } })
    expect(reports.find((r) => r.kind === 'kpiFailed')).toMatchObject({ service: { id: 'failed' }, needsAction: true, at: iso('2026-09-16T00:00:00Z') })
    expect(reports.find((r) => r.kind === 'kpiNeeded')).toMatchObject({ service: { id: 'none' }, needsAction: true })
    // Only recent business-model documents are news.
    expect(reports.filter((r) => r.kind === 'contextReady').map((r) => r.service?.id)).toEqual(['ready'])
    expect(reports.find((r) => r.kind === 'contextReady')?.params.basis).toBe('code')
  })

  it('daily reports start when monitoring started and count events on local days', () => {
    const reports = buildReports(inputs({
      monitoringSince: iso('2026-09-15T02:00:00Z'), // the 15th in Seoul
      incidents: [
        // 00:30 on the 17th in Seoul — today, although it is the 16th in UTC.
        incident({ id: 'today', firedAt: iso('2026-09-16T15:30:00Z') }),
        incident({ id: 'yesterday', alertId: 'alert-b', alertName: 'Refunds', status: 'resolved', severity: 'low',
          firedAt: iso('2026-09-16T01:00:00Z'), resolvedAt: iso('2026-09-16T03:00:00Z'), durationMs: 7_200_000 }),
      ],
    }))
    const daily = reports.filter((r) => r.type === 'daily')
    expect(daily.map((r) => r.params.date)).toEqual(['2026-09-17', '2026-09-16', '2026-09-15'])
    const [today, yesterday, first] = daily
    expect(today).toMatchObject({ live: true, importance: 'high', totals: { fired: 1, resolved: 0, open: 1 } })
    expect(yesterday).toMatchObject({ live: false, importance: 'normal', totals: { fired: 1, resolved: 1, open: 0, mttrMs: 7_200_000 } })
    expect(yesterday.lines).toEqual([expect.objectContaining({ name: 'Refunds', fired: 1, resolved: 1, open: false })])
    // A quiet day is filed too — "no anomaly recorded", low importance.
    expect(first).toMatchObject({ importance: 'low', totals: { fired: 0, resolved: 0, open: 0 }, lines: [] })
    expect(Date.parse(yesterday.at)).toBeLessThan(localDay(NOW, TZ).start)
  })

  it('weekly reports cover completed weeks only, never before monitoring started', () => {
    const early = buildReports(inputs({ monitoringSince: iso('2026-09-15T00:00:00Z') }))
    expect(early.filter((r) => r.type === 'weekly')).toEqual([])

    const reports = buildReports(inputs({
      monitoringSince: iso('2026-09-01T00:00:00Z'),
      incidents: [incident({ id: 'last-week', status: 'resolved', firedAt: iso('2026-09-09T01:00:00Z'), resolvedAt: iso('2026-09-09T02:00:00Z'), durationMs: 3_600_000 })],
    }))
    const weekly = reports.filter((r) => r.type === 'weekly')
    expect(weekly.map((r) => [r.params.start, r.params.end])).toEqual([['2026-09-07', '2026-09-13'], ['2026-08-31', '2026-09-06']])
    expect(weekly[0]).toMatchObject({ importance: 'normal', totals: { fired: 1, resolved: 1, mttrMs: 3_600_000 } })
    expect(weekly[1]).toMatchObject({ importance: 'low', totals: { fired: 0 } })
  })

  it('a service scope keeps only that service and compiles its own daily report', () => {
    const reports = buildReports(inputs({
      monitoringSince: iso('2026-09-17T00:00:00Z'),
      services: [service(), service({ id: 'svc-b', name: 'Billing', recovery: 'reconnect', board: 'degraded', brokenCount: 1, erroredCount: 1 })],
      incidents: [incident(), incident({ id: 'other', dataSourceId: 'svc-b', dataSourceName: 'Billing' })],
    }), { id: 'svc-a', name: 'Production' })
    expect(reports.some((r) => r.service?.id === 'svc-b' || r.id.includes('other'))).toBe(false)
    expect(reports.find((r) => r.type === 'daily')).toMatchObject({ id: 'daily:svc-a:2026-09-17', service: { id: 'svc-a' }, totals: { fired: 1 } })
  })

  it('the action shelf puts the most important first, then the newest', () => {
    const reports = buildReports(inputs({
      services: [service({ pendingCount: 3 }), service({ id: 'svc-b', name: 'Billing', recovery: 'reconnect', board: 'degraded', brokenCount: 1 })],
      incidents: [incident({ severity: 'medium' })],
    }))
    expect(actionReports(reports).map((r) => r.kind)).toEqual(['connection', 'kpiReady', 'incident'])
  })
})
