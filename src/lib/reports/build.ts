/**
 * Report feed — PURE builder for the overview's "report inbox" (no io, no formatting).
 *
 * The overview reads like an operations staff member filing reports to the owner: urgent reports
 * when a metric leaves its range, a follow-up when it recovers, a daily and a weekly report, and
 * analysis reports as a data source is understood. Every report is DERIVED from records that
 * already exist — incidents (alert_events), monitor state, KPI extractions, context documents —
 * so nothing here is invented: a quiet day says "no anomaly recorded", never "everything was fine",
 * because past check results are not stored.
 *
 * Titles and bodies are message keys + params (the view translates), numbers stay raw (the view
 * formats), so this module is shared by the page, the dev gallery and the tests unchanged.
 */

import { splitExplanation, type AckKind, type Incident } from '@/lib/alerts/incidents'
import type { BoardState, ServiceStage } from '@/lib/activation/overview-stage'

export type ReportType = 'urgent' | 'resolved' | 'daily' | 'weekly' | 'analysis'

/** The specific report — picks the title/summary copy and the document sections. */
export type ReportKind =
  | 'incident'
  | 'connection'
  | 'degraded'
  | 'paused'
  | 'resolved'
  | 'daily'
  | 'weekly'
  | 'kpiReady'
  | 'kpiFailed'
  | 'kpiNeeded'
  | 'contextReady'
  | 'analyzing'
  | 'firstCheck'

export type ReportImportance = 'critical' | 'high' | 'normal' | 'low'

export const IMPORTANCE_RANK: Record<ReportImportance, number> = { critical: 0, high: 1, normal: 2, low: 3 }

/**
 * Where a period report sends the reader: the incidents QUEUE, which is the 감시 screen's second
 * view (/app/monitors?view=incidents). Kept as a literal because this module is the pure builder —
 * `src/app/app/monitors/view.ts` is the canonical link builder for everything that renders. The
 * per-incident hrefs below still point at /app/incidents/[id], which did not move.
 */
const INCIDENTS_VIEW_HREF = '/app/monitors?view=incidents'

export type ReportTag =
  | { kind: 'service'; label: string }
  | { kind: 'metric'; label: string }
  | { kind: 'ai' }
  | { kind: 'action' }

export interface ReportMetric {
  name: string
  alertType: Incident['alertType']
  value: number | null
  threshold: number | null
  operator: string | null
  changePct: number | null
  zScore: number | null
}

/** One monitor's line in a daily/weekly report. */
export interface ReportLine {
  alertId: string
  name: string
  serviceName: string | null
  fired: number
  resolved: number
  /** still out of range at the end of the period (or now) */
  open: boolean
}

export interface Report {
  /** Stable across loads — used for the deep link (?report=) and the unread marker. */
  id: string
  type: ReportType
  kind: ReportKind
  importance: ReportImportance
  /** The owner has to do something (review, reconnect, acknowledge). */
  needsAction: boolean
  /** Filed at (ISO). Live status reports (connection, paused, analyzing…) carry `now`. */
  at: string
  /** A live status report: it describes the present, not a moment in the past. */
  live: boolean
  service: { id: string; name: string } | null
  /** Values for the title/summary message keys. */
  params: Record<string, string | number>
  tags: ReportTag[]
  href: string
  metric?: ReportMetric
  /** The AI investigation, fact separated from hypothesis. */
  findings?: { confirmed: string | null; likely: string | null; investigating: boolean }
  /** incident reports: the FIRED alert_events.id (acknowledge target) and its acknowledgement */
  incidentId?: string
  ack?: { at: string; kind: AckKind } | null
  durationMs?: number
  period?: { start: string; end: string }
  lines?: ReportLine[]
  totals?: { fired: number; resolved: number; open: number; mttrMs: number | null }
}

export interface ReportService {
  id: string
  name: string
  stage: ServiceStage
  board: BoardState
  recovery: 'reconnect' | 'scan_failed' | null
  monitorCount: number
  monitorTotal: number
  erroredCount: number
  brokenCount: number
  pendingCount: number
  kpiHref: string
  reconnectHref: string
}

export interface ReportExtraction {
  dataSourceId: string
  status: 'running' | 'completed' | 'failed' | string
  createdAt: string
  completedAt: string | null
  proposedCount: number | null
}

export interface ReportContext {
  dataSourceId: string
  status: string
  generatedAt: string | null
  fromRepo: boolean
}

export interface ReportInputs {
  now: number
  timeZone: string
  services: ReportService[]
  /** Incidents with the data source their monitor watches. */
  incidents: (Incident & { dataSourceId: string | null })[]
  /** The latest extraction per data source. */
  extractions: ReportExtraction[]
  contexts: ReportContext[]
  /** When the org's first monitor was created — daily/weekly reports never predate monitoring. */
  monitoringSince: string | null
  /** Days of daily reports to file (including today). */
  days?: number
  /** Completed weeks of weekly reports to file. */
  weeks?: number
}

const DAY_MS = 86_400_000
/** A context document is worth a report while it is recent news. */
const CONTEXT_NEWS_MS = 30 * DAY_MS
/** Recovery reports stay in the feed this long. */
const RESOLVED_NEWS_MS = 7 * DAY_MS

/* ---------------- time-zone calendar helpers ---------------- */

function zonedParts(ms: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  )
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, min: +parts.minute, s: +parts.second }
}

/** UTC instant of local midnight for the calendar date y-m-d in `timeZone`. */
function zonedMidnight(y: number, m: number, d: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d)
  const p = zonedParts(guess, timeZone)
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - guess
  const first = guess - offset
  // Re-check once across a DST edge.
  const q = zonedParts(first, timeZone)
  const offset2 = Date.UTC(q.y, q.m - 1, q.d, q.h, q.min, q.s) - first
  return guess - offset2
}

/** Local day containing `ms`: [start, end) instants + a stable yyyy-mm-dd key. */
export function localDay(ms: number, timeZone: string): { key: string; start: number; end: number; y: number; m: number; d: number } {
  const p = zonedParts(ms, timeZone)
  const start = zonedMidnight(p.y, p.m, p.d, timeZone)
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1))
  const end = zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone)
  const key = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
  return { key, start, end, y: p.y, m: p.m, d: p.d }
}

/** Local Monday-start week containing `ms`. */
export function localWeek(ms: number, timeZone: string): { start: number; end: number; key: string } {
  const day = localDay(ms, timeZone)
  const dow = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay() // 0 = Sunday
  const back = (dow + 6) % 7
  const monday = new Date(Date.UTC(day.y, day.m - 1, day.d - back))
  const start = zonedMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone)
  const nextMonday = new Date(Date.UTC(day.y, day.m - 1, day.d - back + 7))
  const end = zonedMidnight(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate(), timeZone)
  return { start, end, key: localDay(start, timeZone).key }
}

/* ---------------- builders ---------------- */

const SEVERITY_IMPORTANCE: Record<Incident['severity'], ReportImportance> = { high: 'critical', medium: 'high', low: 'normal' }

function serviceTag(service: { name: string } | null): ReportTag[] {
  return service ? [{ kind: 'service', label: service.name }] : []
}

function incidentReports(inputs: ReportInputs, byId: Map<string, ReportService>): Report[] {
  const out: Report[] = []
  for (const inc of inputs.incidents) {
    const svc = inc.dataSourceId ? byId.get(inc.dataSourceId) ?? null : null
    const service = svc ? { id: svc.id, name: svc.name } : null
    const metric: ReportMetric = {
      name: inc.alertName,
      alertType: inc.alertType,
      value: inc.value,
      threshold: inc.threshold,
      operator: inc.operator,
      changePct: inc.changePct,
      zScore: inc.zScore,
    }
    const split = splitExplanation(inc.explanation)
    const findings = {
      confirmed: split.confirmed,
      // An explanation without the fact/hypothesis markers is still the AI's account.
      likely: split.likely ?? (split.confirmed ? null : inc.explanation?.trim() || null),
      investigating: inc.status === 'investigating',
    }
    const hasAi = !!(findings.confirmed || findings.likely)

    if (inc.status !== 'resolved') {
      out.push({
        id: `incident:${inc.id}`,
        type: 'urgent',
        kind: 'incident',
        importance: SEVERITY_IMPORTANCE[inc.severity],
        needsAction: !inc.ack,
        at: inc.firedAt,
        live: false,
        service,
        params: { metric: inc.alertName, service: service?.name ?? inc.dataSourceName ?? '' },
        tags: [...serviceTag(service), { kind: 'metric', label: inc.alertName }, ...(hasAi || findings.investigating ? [{ kind: 'ai' } as const] : [])],
        href: `/app/incidents/${inc.id}`,
        metric,
        findings,
        incidentId: inc.id,
        ack: inc.ack ? { at: inc.ack.at, kind: inc.ack.kind } : null,
        durationMs: inc.durationMs,
      })
    } else if (inc.resolvedAt && inputs.now - Date.parse(inc.resolvedAt) <= RESOLVED_NEWS_MS) {
      out.push({
        id: `resolved:${inc.id}`,
        type: 'resolved',
        kind: 'resolved',
        importance: 'low',
        needsAction: false,
        at: inc.resolvedAt,
        live: false,
        service,
        params: { metric: inc.alertName, service: service?.name ?? inc.dataSourceName ?? '' },
        tags: [...serviceTag(service), { kind: 'metric', label: inc.alertName }],
        href: `/app/incidents/${inc.id}`,
        metric: { ...metric, value: inc.resolvedValue },
        findings: hasAi ? findings : undefined,
        incidentId: inc.id,
        ack: inc.ack ? { at: inc.ack.at, kind: inc.ack.kind } : null,
        durationMs: inc.durationMs,
      })
    }
  }
  return out
}

function serviceReports(inputs: ReportInputs): Report[] {
  const now = new Date(inputs.now).toISOString()
  const out: Report[] = []
  const extraction = new Map(inputs.extractions.map((e) => [e.dataSourceId, e]))
  const context = new Map(inputs.contexts.map((c) => [c.dataSourceId, c]))

  for (const svc of inputs.services) {
    const service = { id: svc.id, name: svc.name }
    const base = { service, live: true, at: now, tags: serviceTag(service) }

    if (svc.recovery === 'reconnect') {
      out.push({ ...base, id: `connection:${svc.id}`, type: 'urgent', kind: 'connection', importance: 'critical', needsAction: true,
        params: { service: svc.name, count: svc.brokenCount }, tags: [...base.tags, { kind: 'action' }], href: svc.reconnectHref })
    } else if (svc.stage === 'operating' && svc.board === 'degraded') {
      out.push({ ...base, id: `degraded:${svc.id}`, type: 'urgent', kind: 'degraded', importance: 'high', needsAction: true,
        params: { service: svc.name, count: svc.erroredCount, total: svc.monitorCount }, tags: [...base.tags, { kind: 'action' }], href: '/app/monitors' })
    }

    const ext = extraction.get(svc.id)
    switch (svc.stage) {
      case 'paused':
        out.push({ ...base, id: `paused:${svc.id}`, type: 'analysis', kind: 'paused', importance: 'high', needsAction: true,
          params: { service: svc.name, count: svc.monitorTotal }, tags: [...base.tags, { kind: 'action' }], href: '/app/monitors' })
        break
      case 'analyzing':
        out.push({ ...base, id: `analyzing:${svc.id}`, type: 'analysis', kind: 'analyzing', importance: 'normal', needsAction: false,
          params: { service: svc.name }, tags: [...base.tags, { kind: 'ai' }], href: svc.kpiHref })
        break
      case 'first_check':
        out.push({ ...base, id: `first-check:${svc.id}`, type: 'analysis', kind: 'firstCheck', importance: 'low', needsAction: false,
          params: { service: svc.name, count: svc.monitorCount }, href: '/app/monitors' })
        break
      case 'extract':
        if (ext?.status === 'failed') {
          out.push({ ...base, id: `kpi-failed:${svc.id}:${ext.createdAt}`, type: 'analysis', kind: 'kpiFailed', importance: 'high', needsAction: true,
            live: false, at: ext.completedAt ?? ext.createdAt, params: { service: svc.name }, tags: [...base.tags, { kind: 'action' }], href: svc.kpiHref })
        } else {
          out.push({ ...base, id: `kpi-needed:${svc.id}`, type: 'analysis', kind: 'kpiNeeded', importance: 'normal', needsAction: true,
            params: { service: svc.name }, tags: [...base.tags, { kind: 'action' }], href: svc.kpiHref })
        }
        break
    }

    // Proposals waiting — whatever the stage (an operating service can have new ones too).
    if (svc.pendingCount > 0) {
      const at = ext?.status === 'completed' ? ext.completedAt ?? ext.createdAt : now
      out.push({ ...base, id: `kpi-ready:${svc.id}:${ext?.createdAt ?? 'pending'}`, type: 'analysis', kind: 'kpiReady', importance: 'high', needsAction: true,
        live: at === now, at, params: { service: svc.name, count: svc.pendingCount }, tags: [...base.tags, { kind: 'ai' }, { kind: 'action' }], href: svc.kpiHref })
    }

    const ctx = context.get(svc.id)
    if (ctx?.status === 'fresh' && ctx.generatedAt && inputs.now - Date.parse(ctx.generatedAt) <= CONTEXT_NEWS_MS) {
      out.push({ ...base, id: `context:${svc.id}:${ctx.generatedAt}`, type: 'analysis', kind: 'contextReady', importance: 'low', needsAction: false,
        live: false, at: ctx.generatedAt, params: { service: svc.name, basis: ctx.fromRepo ? 'code' : 'schema' },
        tags: [...base.tags, { kind: 'ai' }], href: `/app/business-model/${svc.id}` })
    }
  }
  return out
}

/** Monitors with fired/resolved events inside [start, end), plus the incidents still open at `end`. */
function periodLines(inputs: ReportInputs, start: number, end: number): { lines: ReportLine[]; fired: number; resolved: number; open: number; mttrMs: number | null } {
  const lines = new Map<string, ReportLine>()
  let fired = 0
  let resolved = 0
  let open = 0
  const durations: number[] = []
  const line = (inc: ReportInputs['incidents'][number]) => {
    const existing = lines.get(inc.alertId)
    if (existing) return existing
    const created: ReportLine = { alertId: inc.alertId, name: inc.alertName, serviceName: inc.dataSourceName, fired: 0, resolved: 0, open: false }
    lines.set(inc.alertId, created)
    return created
  }
  for (const inc of inputs.incidents) {
    const firedAt = Date.parse(inc.firedAt)
    const resolvedAt = inc.resolvedAt ? Date.parse(inc.resolvedAt) : null
    if (firedAt >= start && firedAt < end) {
      line(inc).fired++
      fired++
    }
    if (resolvedAt !== null && resolvedAt >= start && resolvedAt < end) {
      line(inc).resolved++
      resolved++
      durations.push(inc.durationMs)
    }
    // Still out of range when the period closed (it may have fired on an earlier day).
    if (firedAt < end && (resolvedAt === null || resolvedAt >= end)) {
      line(inc).open = true
      open++
    }
  }
  const sorted = [...lines.values()]
    .filter((l) => l.fired > 0 || l.resolved > 0 || l.open)
    .sort((a, b) => Number(b.open) - Number(a.open) || b.fired - a.fired || a.name.localeCompare(b.name))
  const mttrMs = durations.length ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : null
  return { lines: sorted, fired, resolved, open, mttrMs }
}

function dailyReports(inputs: ReportInputs, scope: { id: string; name: string } | null): Report[] {
  if (!inputs.monitoringSince) return []
  const since = localDay(Date.parse(inputs.monitoringSince), inputs.timeZone).start
  const out: Report[] = []
  // Walk back one calendar day at a time (DST-safe: step to the instant before a day's start).
  let day = localDay(inputs.now, inputs.timeZone)
  for (let i = 0; i < (inputs.days ?? 7); i++, day = localDay(day.start - 1, inputs.timeZone)) {
    if (day.end <= since) break
    const isToday = i === 0
    const end = isToday ? inputs.now + 1 : day.end
    const { lines, fired, resolved, open, mttrMs } = periodLines(inputs, day.start, end)
    const importance: ReportImportance = open > 0 && fired > 0 ? 'high' : fired > 0 ? 'normal' : 'low'
    out.push({
      id: `daily:${scope?.id ?? 'org'}:${day.key}`,
      type: 'daily',
      kind: 'daily',
      importance,
      needsAction: false,
      // Today's report is a live draft; a past day is filed at its close.
      at: new Date(isToday ? inputs.now : day.end - 1000).toISOString(),
      live: isToday,
      service: scope,
      params: { date: day.key, fired, resolved, open },
      tags: serviceTag(scope),
      href: INCIDENTS_VIEW_HREF,
      period: { start: new Date(day.start).toISOString(), end: new Date(Math.min(day.end, inputs.now)).toISOString() },
      lines,
      totals: { fired, resolved, open, mttrMs },
    })
  }
  return out
}

function weeklyReports(inputs: ReportInputs, scope: { id: string; name: string } | null): Report[] {
  if (!inputs.monitoringSince) return []
  const since = Date.parse(inputs.monitoringSince)
  const out: Report[] = []
  let week = localWeek(localWeek(inputs.now, inputs.timeZone).start - 1, inputs.timeZone) // last completed week
  for (let i = 0; i < (inputs.weeks ?? 2); i++) {
    if (week.end <= since) break
    const { lines, fired, resolved, open, mttrMs } = periodLines(inputs, week.start, week.end)
    out.push({
      id: `weekly:${scope?.id ?? 'org'}:${week.key}`,
      type: 'weekly',
      kind: 'weekly',
      importance: fired > 0 ? 'normal' : 'low',
      needsAction: false,
      at: new Date(week.end - 1000).toISOString(),
      live: false,
      service: scope,
      params: { start: localDay(week.start, inputs.timeZone).key, end: localDay(week.end - 1, inputs.timeZone).key, fired, resolved },
      tags: serviceTag(scope),
      href: INCIDENTS_VIEW_HREF,
      period: { start: new Date(week.start).toISOString(), end: new Date(week.end).toISOString() },
      lines,
      totals: { fired, resolved, open, mttrMs },
    })
    week = localWeek(week.start - 1, inputs.timeZone)
  }
  return out
}

/**
 * Every report for the org — or for one data source when `scope` is set (the single-service
 * view): incidents, status and analysis reports are filtered to it, and the daily/weekly
 * reports are compiled from its monitors only.
 */
export function buildReports(inputs: ReportInputs, scope: { id: string; name: string } | null = null): Report[] {
  const scoped: ReportInputs = scope
    ? {
        ...inputs,
        services: inputs.services.filter((s) => s.id === scope.id),
        incidents: inputs.incidents.filter((i) => i.dataSourceId === scope.id),
      }
    : inputs
  const byId = new Map(scoped.services.map((s) => [s.id, s]))
  return sortReports([
    ...incidentReports(scoped, byId),
    ...serviceReports(scoped),
    ...dailyReports(scoped, scope),
    ...weeklyReports(scoped, scope),
  ])
}

/** Newest first; at the same instant the more important report leads. */
export function sortReports(reports: Report[]): Report[] {
  return [...reports].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] || a.id.localeCompare(b.id),
  )
}

/** The "needs your attention" shelf: open actions, most important first, then newest. */
export function actionReports(reports: Report[]): Report[] {
  return reports
    .filter((r) => r.needsAction)
    .sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] || Date.parse(b.at) - Date.parse(a.at))
}
