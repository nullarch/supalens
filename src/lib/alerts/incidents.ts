// PURE incident model over alert_events — no io, no React, no server imports (importable from
// client components and the Trigger runtime alike). The io shell is ./incidents-server.ts.
// The one import, `@/lib/org/timezone`, is itself import-free and free of `server-only`, so it
// keeps that contract.
//
// An "incident" is one FIRED alert_event. It is resolved by the next RESOLVED event of the same
// monitor, "investigating" while the root-cause agent hasn't reported yet, and "open" otherwise.
// Nothing here needs the ack/feedback columns (migration `*_incident_ack.sql`) — they are optional
// on the input rows so the model works before and after that migration is applied.

import { DEFAULT_TIMEZONE, formatInOrgTz, utcOffsetLabel } from '@/lib/org/timezone'
// pure too (zod only) — a goal monitor's structured rule decides how its incidents are graded
import { conditionViewOf, type ConditionView } from './condition'

export type IncidentStatus = 'open' | 'investigating' | 'resolved'
export type IncidentSeverity = 'high' | 'medium' | 'low'
export type AckKind = 'ack' | 'expected'
export type CauseFeedback = 'correct' | 'partial' | 'wrong'

/** The ack/feedback columns are plain text in the DB (and absent before the migration),
 *  so every read narrows through these guards rather than trusting the row type. */
export function isCauseFeedback(v: unknown): v is CauseFeedback {
  return v === 'correct' || v === 'partial' || v === 'wrong'
}

/** alert_events row subset (snake_case = DB shape; ack columns optional pre-migration). */
export interface IncidentEventRow {
  id: string
  alert_id: string
  kind: 'fired' | 'resolved' | string
  value: number | null
  message: string | null
  explanation: string | null
  explained: boolean | null
  notified: boolean
  created_at: string
  acknowledged_at?: string | null
  acknowledged_by?: string | null
  ack_kind?: AckKind | string | null
  cause_feedback?: CauseFeedback | string | null
  cause_correction?: string | null
}

/** alerts row subset the model needs to label + grade an incident. */
export interface IncidentAlertRow {
  id: string
  name: string
  type: string
  operator: string
  threshold: number
  sensitivity: number | null
  fire_threshold?: number | null
  data_source_id?: string
  data_source_name?: string | null
  /** goal monitors' structured rule (absent before the goal migration / on legacy monitors) */
  condition?: unknown
}

export interface Incident {
  /** the FIRED alert_events.id — the incident's identity */
  id: string
  alertId: string
  alertName: string
  alertType: 'threshold' | 'anomaly' | 'change_rate'
  dataSourceName: string | null
  status: IncidentStatus
  severity: IncidentSeverity
  /** value at fire time */
  value: number | null
  /** threshold for threshold-type monitors; null for anomaly */
  threshold: number | null
  operator: string | null
  /** (value − threshold) / |threshold| × 100 for threshold monitors, when computable */
  changePct: number | null
  /** z-score parsed from the anomaly message ("3.2σ"), Infinity for "∞σ", null when absent */
  zScore: number | null
  fireThreshold: number
  firedAt: string
  resolvedAt: string | null
  resolvedValue: number | null
  /** resolved − fired, or now − fired while open */
  durationMs: number
  message: string | null
  explanation: string | null
  explained: boolean
  notified: boolean
  ack: { at: string; by: string | null; kind: AckKind } | null
  feedback: { value: CauseFeedback; correction: string | null } | null
  /** goal monitors: the rule, for screens that state it in words; absent/null on legacy monitors */
  rule?: ConditionView | null
}

/** Root-cause runs finish well inside this; past it a missing explanation means the run failed. */
export const INVESTIGATING_WINDOW_MS = 15 * 60_000

const Z_RE = /(∞|\d+(?:[.,]\d+)?)\s*σ/

/** Parse the z-score the runner embeds in an anomaly message ("… (평소 평균 120 대비 3.4σ 이탈)"). */
export function parseZScore(message: string | null | undefined): number | null {
  if (!message) return null
  const m = Z_RE.exec(message)
  if (!m) return null
  if (m[1] === '∞') return Number.POSITIVE_INFINITY
  const n = Number(m[1].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Severity — a grade an operator can triage by, derived (not stored):
 *  threshold monitors: relative distance from the threshold (≥50% high, ≥20% medium, else low);
 *  anomaly monitors: the z-score when the message carries one (≥6σ or ∞ high, ≥4σ medium, else
 *  low — firing already means ≥ sensitivity), medium when it can't be parsed.
 */
export function deriveSeverity(
  alert: Pick<IncidentAlertRow, 'type' | 'threshold'>,
  value: number | null,
  message: string | null,
): IncidentSeverity {
  if (alert.type === 'anomaly') {
    const z = parseZScore(message)
    if (z === null) return 'medium'
    if (z === Number.POSITIVE_INFINITY || z >= 6) return 'high'
    if (z >= 4) return 'medium'
    return 'low'
  }
  if (value === null || !Number.isFinite(value)) return 'medium'
  const denom = Math.max(Math.abs(alert.threshold), 1e-9)
  const dev = Math.abs(value - alert.threshold) / denom
  if (dev >= 0.5) return 'high'
  if (dev >= 0.2) return 'medium'
  return 'low'
}

export function changePercent(alert: Pick<IncidentAlertRow, 'type' | 'threshold'>, value: number | null): number | null {
  if (alert.type === 'anomaly' || value === null || !Number.isFinite(value)) return null
  if (alert.threshold === 0) return null
  return ((value - alert.threshold) / Math.abs(alert.threshold)) * 100
}

export function incidentStatus(
  fired: Pick<IncidentEventRow, 'created_at' | 'explanation' | 'explained'>,
  resolvedAt: string | null,
  nowMs: number,
): IncidentStatus {
  if (resolvedAt) return 'resolved'
  const ageMs = nowMs - Date.parse(fired.created_at)
  const investigating = !fired.explained && !fired.explanation && ageMs >= 0 && ageMs < INVESTIGATING_WINDOW_MS
  return investigating ? 'investigating' : 'open'
}

/**
 * The row the grading logic reads. A goal monitor's legacy columns are placeholders (a relative
 * rule stores threshold 0), so its STRUCTURED rule decides: anomaly → graded by z like any anomaly
 * monitor; absolute → by distance from its number; relative → no fixed line to measure against.
 */
function gradingRow(alert: IncidentAlertRow): { type: string; threshold: number; operator: string; fixedLine: boolean; rule: ConditionView | null } {
  if (alert.condition == null) {
    return { type: alert.type, threshold: alert.threshold, operator: alert.operator, fixedLine: alert.type !== 'anomaly', rule: null }
  }
  const rule = conditionViewOf(alert)
  if (rule.kind === 'absolute') return { type: 'threshold', threshold: rule.threshold, operator: rule.operator, fixedLine: true, rule }
  if (rule.kind === 'anomaly') return { type: 'anomaly', threshold: 0, operator: 'gt', fixedLine: false, rule }
  return { type: 'change_rate', threshold: 0, operator: alert.operator, fixedLine: false, rule }
}

function normType(t: string): Incident['alertType'] {
  return t === 'anomaly' ? 'anomaly' : t === 'change_rate' ? 'change_rate' : 'threshold'
}

/**
 * Turn raw event rows (any order, any kinds, possibly many monitors) into incidents, newest first.
 * Pairing: each FIRED event is resolved by the FIRST RESOLVED event of the same monitor that comes
 * after it and before the next FIRED event — so overlapping histories never cross-link.
 */
export function deriveIncidents(
  events: IncidentEventRow[],
  alertsById: ReadonlyMap<string, IncidentAlertRow>,
  nowMs: number,
): Incident[] {
  const byAlert = new Map<string, IncidentEventRow[]>()
  for (const e of events) {
    const list = byAlert.get(e.alert_id) ?? []
    list.push(e)
    byAlert.set(e.alert_id, list)
  }
  const out: Incident[] = []
  for (const [alertId, list] of byAlert) {
    const alert = alertsById.get(alertId)
    if (!alert) continue // history of a monitor we can't see (RLS) — nothing to label it with
    const grade = gradingRow(alert)
    list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    for (let i = 0; i < list.length; i++) {
      const fired = list[i]
      if (fired.kind !== 'fired') continue
      let resolved: IncidentEventRow | null = null
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].kind === 'fired') break
        if (list[j].kind === 'resolved') {
          resolved = list[j]
          break
        }
      }
      const firedMs = Date.parse(fired.created_at)
      const resolvedAt = resolved?.created_at ?? null
      const endMs = resolvedAt ? Date.parse(resolvedAt) : nowMs
      const ackKind = fired.ack_kind === 'ack' || fired.ack_kind === 'expected' ? fired.ack_kind : null
      const fb = fired.cause_feedback
      const feedback = isCauseFeedback(fb) ? { value: fb, correction: fired.cause_correction ?? null } : null
      out.push({
        id: fired.id,
        alertId,
        alertName: alert.name,
        alertType: normType(alert.type),
        dataSourceName: alert.data_source_name ?? null,
        status: incidentStatus(fired, resolvedAt, nowMs),
        severity: grade.fixedLine || grade.type === 'anomaly' ? deriveSeverity(grade, fired.value, fired.message) : 'medium',
        value: fired.value,
        threshold: grade.fixedLine ? grade.threshold : null,
        operator: grade.fixedLine ? grade.operator : null,
        changePct: grade.fixedLine ? changePercent(grade, fired.value) : null,
        zScore: grade.type === 'anomaly' ? parseZScore(fired.message) : null,
        fireThreshold: alert.fire_threshold ?? 1,
        firedAt: fired.created_at,
        resolvedAt,
        resolvedValue: resolved?.value ?? null,
        durationMs: Math.max(0, endMs - firedMs),
        message: fired.message,
        explanation: fired.explanation,
        explained: Boolean(fired.explained),
        notified: fired.notified,
        ack: fired.acknowledged_at && ackKind ? { at: fired.acknowledged_at, by: fired.acknowledged_by ?? null, kind: ackKind } : null,
        feedback,
        rule: grade.rule,
      })
    }
  }
  out.sort((a, b) => Date.parse(b.firedAt) - Date.parse(a.firedAt))
  return out
}

/**
 * Coarse duration for display, as a unit + count the caller localizes (mirrors
 * health.ts::cadenceParts — the message catalog owns the wording, not this module).
 */
export function durationParts(ms: number): { unit: 'lessThanMinute' | 'minutes' | 'hours' | 'days'; n: number } {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return { unit: 'lessThanMinute', n: 0 }
  if (minutes < 60) return { unit: 'minutes', n: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { unit: 'hours', n: hours }
  return { unit: 'days', n: Math.floor(hours / 24) }
}

/** First sentence of an explanation, for list rows. */
export function firstSentence(text: string | null | undefined, max = 140): string | null {
  if (!text) return null
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  const m = /^(.+?[.!?。])(\s|$)/.exec(trimmed)
  const s = (m ? m[1] : trimmed).trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const CONFIRMED_MARK = /(데이터에서 확인됨|확인된 사실|confirmed in (the )?data|what (was|is) confirmed|confirmed:)/i
const LIKELY_MARK = /(가능성 높은 원인|가능한 원인|추정 원인|가설|likely cause|probable cause|likely driver|hypothesis)/i

/**
 * Split an explanation into the two blocks the product promises — facts confirmed in the data and
 * the AI's hypothesis — WHEN the text itself carries those markers. Without markers the caller
 * renders the whole thing as one block labelled as a hypothesis (never invent a split).
 */
export function splitExplanation(text: string | null | undefined): { confirmed: string | null; likely: string | null } {
  if (!text) return { confirmed: null, likely: null }
  const lines = text.split(/\r?\n/)
  let confirmedIdx = -1
  let likelyIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    // only heading-like lines count as markers (short, or ending with a colon)
    const headingLike = line.length <= 48 || /[:：]\s*$/.test(line)
    if (!headingLike) continue
    if (confirmedIdx < 0 && CONFIRMED_MARK.test(line)) confirmedIdx = i
    else if (likelyIdx < 0 && LIKELY_MARK.test(line)) likelyIdx = i
  }
  if (likelyIdx < 0 && confirmedIdx < 0) return { confirmed: null, likely: null }
  const strip = (arr: string[]) => {
    const s = arr
      .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
      .filter(Boolean)
      .join('\n')
      .trim()
    return s || null
  }
  const stripHeading = (line: string) => line.replace(/^[^:：]*[:：]\s*/, '').trim()
  if (confirmedIdx >= 0 && likelyIdx > confirmedIdx) {
    const confirmed = strip([stripHeading(lines[confirmedIdx]), ...lines.slice(confirmedIdx + 1, likelyIdx)])
    const likely = strip([stripHeading(lines[likelyIdx]), ...lines.slice(likelyIdx + 1)])
    return { confirmed, likely }
  }
  if (likelyIdx >= 0) {
    const before = strip(lines.slice(0, likelyIdx))
    const likely = strip([stripHeading(lines[likelyIdx]), ...lines.slice(likelyIdx + 1)])
    return { confirmed: before, likely }
  }
  // only a "confirmed" marker → everything after it is confirmed, nothing is a hypothesis
  const confirmed = strip([stripHeading(lines[confirmedIdx]), ...lines.slice(confirmedIdx + 1)])
  return { confirmed, likely: null }
}

export interface Segment {
  name: string
  value: string
}

const SEGMENT_LINE = /^\s*[-•*]?\s*([^:：]{1,40}?)\s*[:：]\s*([-+−]?\d+(?:[.,]\d+)?\s*%[^\n]*|normal|정상|unchanged|변화 없음)\s*$/i

/**
 * "US: normal / Japan: −52%"-style segment lists inside an explanation. Returns [] unless at least
 * two lines match, so prose with a stray colon never renders as a fake breakdown.
 */
export function extractSegments(text: string | null | undefined): Segment[] {
  if (!text) return []
  const out: Segment[] = []
  for (const raw of text.split(/\r?\n/)) {
    const m = SEGMENT_LINE.exec(raw)
    if (m) out.push({ name: m[1].trim(), value: m[2].trim() })
  }
  return out.length >= 2 ? out : []
}

/**
 * Question the "Ask follow-up" action prefills (locale-aware, no LLM here).
 *
 * The time is stated in the ORG's declared zone (`organizations.timezone`) with its offset spelled
 * out, so the analyst reads the same clock the incident screens show and the agent is never handed
 * an unlabelled timestamp. `sv-SE` is used only as an ISO-shaped formatting locale ("2026-09-04
 * 18:12") — the prose around it follows `locale`.
 */
export function followUpQuestion(
  inc: Pick<Incident, 'alertName' | 'firedAt'>,
  locale: string | undefined,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const when =
    formatInOrgTz(inc.firedAt, timezone, 'sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) || inc.firedAt.slice(0, 16).replace('T', ' ')
  const zone = utcOffsetLabel(timezone) || DEFAULT_TIMEZONE
  if (locale === 'ko') return `${inc.alertName} 지표가 ${when}(${zone}) 무렵 왜 변했는지 세부적으로 분석해줘`
  if (locale === 'ja') return `${inc.alertName} が ${when}(${zone}) 頃に変化した理由を詳しく分析して`
  return `Explain in detail why "${inc.alertName}" changed around ${when} ${zone}`
}
