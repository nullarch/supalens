/**
 * Goal-monitor conditions — PURE (no db / io / env / React). Design: docs/goal-monitors-plan.md.
 *
 * A goal monitor's `metric_sql` returns a SERIES (bucket as the FIRST column, the measure as the
 * LAST column, oldest → newest) and `alerts.condition` holds one of these structured rules. The
 * rule — not the SQL — decides when the monitor fires, so the same function drives:
 *   - the scheduled runner (Trigger host) and the "test now" / recovery checks,
 *   - the drafting agent's validator (propose_monitor),
 *   - the browser's approval-time backtest ("this would have fired 2× in 90 days"), recomputed
 *     live as the operator drags the sensitivity slider.
 *
 * Three strategies, picked by the drafting agent from the operator's words:
 *   anomaly   — "tell me when it looks off": direction-aware z-score of the latest complete point
 *               vs a BOUNDED trailing window (the baseline follows growth instead of anchoring on
 *               ancient history — the structural answer to "signups tripled, raise the bar").
 *   relative  — "30% below last week": % change vs the trailing average.
 *   absolute  — a number the operator actually gave ("failure rate above 5%").
 *
 * No `import 'server-only'`: shared with the Trigger.dev runtime AND client components.
 */
import { z } from 'zod'

import { conditionMet, decideTransition, MIN_ANOMALY_BASELINE, type AlertOp, type AlertStatus } from './evaluate'

export const CONDITION_VERSION = 1

export const ALERT_OPS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const
export const DIRECTIONS = ['down', 'up', 'both'] as const
export type Direction = (typeof DIRECTIONS)[number]

/** Trailing points the anomaly baseline uses by default: four weeks of daily buckets. */
export const DEFAULT_ANOMALY_WINDOW = 28
/** Trailing points a relative condition averages by default: one week of daily buckets. */
export const DEFAULT_RELATIVE_WINDOW = 7
export const MAX_WINDOW = 90
/** A flat baseline still gets a noise floor of 5% of its mean — otherwise a metric that sat at
 *  exactly 100 for a month would read 99 as an infinite-sigma anomaly. */
const STDDEV_FLOOR_RATIO = 0.05

export const AnomalyCondition = z.object({
  v: z.literal(CONDITION_VERSION),
  strategy: z.literal('anomaly'),
  direction: z.enum(DIRECTIONS),
  /** z-score cutoff (σ). 3 = "clearly unusual". */
  sensitivity: z.number().min(1).max(6),
  /** trailing baseline points (≥ the minimum history an anomaly needs). */
  window: z.number().int().min(MIN_ANOMALY_BASELINE).max(MAX_WINDOW),
})

export const RelativeCondition = z.object({
  v: z.literal(CONDITION_VERSION),
  strategy: z.literal('relative'),
  direction: z.enum(['down', 'up']),
  /** change as a FRACTION of the baseline: 0.3 = 30%. */
  pct: z.number().min(0.01).max(10),
  /** trailing points averaged into the baseline (1 = vs the previous bucket). */
  window: z.number().int().min(1).max(MAX_WINDOW),
})

export const AbsoluteCondition = z.object({
  v: z.literal(CONDITION_VERSION),
  strategy: z.literal('absolute'),
  operator: z.enum(ALERT_OPS),
  threshold: z.number().finite(),
})

export const MonitorCondition = z.discriminatedUnion('strategy', [AnomalyCondition, RelativeCondition, AbsoluteCondition])
export type MonitorCondition = z.infer<typeof MonitorCondition>
export type ConditionStrategy = MonitorCondition['strategy']

/** Parse a stored/untrusted condition; null when absent or malformed (→ legacy evaluation). */
export function parseCondition(raw: unknown): MonitorCondition | null {
  if (raw === null || raw === undefined) return null
  const parsed = MonitorCondition.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// ── series ────────────────────────────────────────────────────────────────

export interface SeriesPoint {
  /** calendar date of the bucket ("YYYY-MM-DD"), null when the first column isn't a date */
  bucket: string | null
  value: number
}

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})/

/**
 * The calendar date a bucket value names. Strings are read literally (the Management API returns
 * `"2026-09-27"` / `"2026-09-27 00:00:00+00"`); a JS Date comes from the pg driver, which builds a
 * `date` column at LOCAL midnight — so a local-midnight Date reads its local date, any other Date
 * (a timestamptz instant) its UTC date.
 */
export function bucketDateOf(v: unknown): string | null {
  if (typeof v === 'string') return ISO_DATE.exec(v.trim())?.[1] ?? null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const localMidnight = v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0 && v.getMilliseconds() === 0
    const y = localMidnight ? v.getFullYear() : v.getUTCFullYear()
    const m = (localMidnight ? v.getMonth() : v.getUTCMonth()) + 1
    const d = localMidnight ? v.getDate() : v.getUTCDate()
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

/** First column = bucket, LAST column = measure (same reading as seriesFromRows); non-numeric rows skipped. */
export function seriesPointsFromRows(columns: string[], rows: Array<Record<string, unknown>>): SeriesPoint[] {
  if (columns.length === 0) return []
  const bucketCol = columns[0]
  const valueCol = columns[columns.length - 1]
  const out: SeriesPoint[] = []
  for (const row of rows) {
    const raw = row[valueCol]
    if (raw === null || raw === undefined || raw === '') continue
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) continue
    out.push({ bucket: columns.length > 1 ? bucketDateOf(row[bucketCol]) : null, value: n })
  }
  return out
}

/** "YYYY-MM-DD" of an instant in a zone (UTC on an unknown zone). */
export function dateInZone(nowMs: number, timezone: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
  try {
    return fmt(timezone || 'UTC')
  } catch {
    return fmt('UTC')
  }
}

/**
 * Drop the trailing buckets that are still IN PROGRESS. A daily series that includes today would
 * compare a few hours of today against full days — every monitor would "detect a drop" each
 * morning. We cannot know which zone the SQL bucketed in, so the cutoff is the EARLIER of today in
 * UTC and today in the org's zone: a partial bucket is never evaluated in either convention, at
 * the cost of evaluating a just-completed bucket up to a zone offset later.
 */
export function dropInProgress(
  points: SeriesPoint[],
  nowMs: number,
  timezone: string,
): { points: SeriesPoint[]; dropped: number } {
  const utc = dateInZone(nowMs, 'UTC')
  const local = dateInZone(nowMs, timezone)
  const cutoff = utc < local ? utc : local
  let end = points.length
  while (end > 0) {
    const b = points[end - 1].bucket
    if (b === null || b < cutoff) break
    end--
  }
  return { points: end === points.length ? points : points.slice(0, end), dropped: points.length - end }
}

// ── evaluation ────────────────────────────────────────────────────────────

export interface ConditionEval {
  met: boolean
  /** the evaluated (latest complete) point; null for an empty series */
  latest: number | null
  /** not enough history for the strategy's baseline yet — never fires */
  insufficient: boolean
  /** baseline points actually used */
  baselineN: number
  mean: number | null
  /** the stddev used (noise floor applied) */
  stddev: number | null
  /** SIGNED z-score (anomaly) */
  z: number | null
  /** SIGNED change as a fraction of the baseline (relative) */
  change: number | null
  /** the range the latest point is expected to stay inside — null on an open side */
  lower: number | null
  upper: number | null
}

function blank(latest: number | null, insufficient: boolean): ConditionEval {
  return { met: false, latest, insufficient, baselineN: 0, mean: null, stddev: null, z: null, change: null, lower: null, upper: null }
}

function stats(values: number[], from: number, to: number): { mean: number; sd: number } {
  const n = to - from
  let sum = 0
  for (let i = from; i < to; i++) sum += values[i]
  const mean = sum / n
  let sq = 0
  for (let i = from; i < to; i++) sq += (values[i] - mean) * (values[i] - mean)
  return { mean, sd: Math.sqrt(sq / n) }
}

/**
 * Evaluate the condition at the point `values[end - 1]` (default: the last point), using only the
 * points before it as the baseline. `end` lets the backtest replay history without copying.
 */
export function evaluateCondition(values: number[], cond: MonitorCondition, end = values.length): ConditionEval {
  if (end <= 0) return blank(null, true)
  const latest = values[end - 1]

  if (cond.strategy === 'absolute') {
    const met = conditionMet(latest, cond.operator, cond.threshold)
    const r = blank(latest, false)
    r.met = met
    // the healthy range is the INVERSE of the firing condition
    if (cond.operator === 'lt' || cond.operator === 'lte') r.lower = cond.threshold
    if (cond.operator === 'gt' || cond.operator === 'gte') r.upper = cond.threshold
    return r
  }

  const window = cond.window
  const from = Math.max(0, end - 1 - window)
  const n = end - 1 - from

  if (cond.strategy === 'relative') {
    if (n < window) return { ...blank(latest, true), baselineN: n }
    const { mean } = stats(values, from, end - 1)
    const r: ConditionEval = { ...blank(latest, false), baselineN: n, mean }
    if (mean === 0) return r // a % change against zero is undefined — never fires
    const change = (latest - mean) / Math.abs(mean)
    r.change = change
    r.met = cond.direction === 'down' ? change <= -cond.pct : change >= cond.pct
    if (cond.direction === 'down') r.lower = mean - cond.pct * Math.abs(mean)
    else r.upper = mean + cond.pct * Math.abs(mean)
    return r
  }

  // anomaly
  if (n < MIN_ANOMALY_BASELINE) return { ...blank(latest, true), baselineN: n }
  const { mean, sd } = stats(values, from, end - 1)
  const sdEff = Math.max(sd, STDDEV_FLOOR_RATIO * Math.abs(mean))
  const k = cond.sensitivity
  const z = sdEff === 0 ? (latest === mean ? 0 : latest > mean ? Infinity : -Infinity) : (latest - mean) / sdEff
  const met = cond.direction === 'down' ? z <= -k : cond.direction === 'up' ? z >= k : Math.abs(z) >= k
  return {
    met,
    latest,
    insufficient: false,
    baselineN: n,
    mean,
    stddev: sdEff,
    z,
    change: null,
    lower: cond.direction === 'up' ? null : mean - k * sdEff,
    upper: cond.direction === 'down' ? null : mean + k * sdEff,
  }
}

// ── backtest ──────────────────────────────────────────────────────────────

export interface BacktestResult {
  /** points that had enough history to be evaluated */
  evaluated: number
  /** normal → firing edges the monitor would have produced */
  fires: number
  /** indices (into `values`) of those firing edges */
  firedIndices: number[]
}

/**
 * Replay the monitor over its own history: evaluate every point against the points before it and
 * run the SAME hysteresis the runner uses (`decideTransition`), counting firing edges. This is the
 * number the operator approves against — "this would have alerted you twice in 90 days".
 * Cooldown is ignored: history buckets are a day apart, far beyond any cooldown.
 */
export function backtestCondition(values: number[], cond: MonitorCondition, opts: { fireThreshold?: number } = {}): BacktestResult {
  const fireThreshold = Math.max(1, opts.fireThreshold ?? 1)
  let state: { status: AlertStatus; consecutiveFires: number; lastNotifiedAt: string | null } = {
    status: 'normal',
    consecutiveFires: 0,
    lastNotifiedAt: null,
  }
  const firedIndices: number[] = []
  let evaluated = 0
  for (let end = 1; end <= values.length; end++) {
    const ev = evaluateCondition(values, cond, end)
    if (ev.insufficient) continue
    evaluated++
    const t = decideTransition(ev.met, state, { operator: 'gt', threshold: 0, fireThreshold, cooldownSeconds: 0 }, 0)
    if (t.edge === 'fired') firedIndices.push(end - 1)
    state = { status: t.status, consecutiveFires: t.consecutiveFires, lastNotifiedAt: null }
  }
  return { evaluated, fires: firedIndices.length, firedIndices }
}

// ── legacy column projection + display ────────────────────────────────────

export interface LegacyAlertColumns {
  type: 'threshold' | 'change_rate' | 'anomaly'
  operator: AlertOp
  threshold: number
  sensitivity: number | null
}

/**
 * The legacy columns a goal monitor still writes, so every reader that predates `condition`
 * (the type label, list_alerts, older screens) keeps seeing a coherent row. Evaluation never reads
 * these when `condition` is set.
 */
export function legacyColumnsFor(cond: MonitorCondition): LegacyAlertColumns {
  switch (cond.strategy) {
    case 'anomaly':
      return { type: 'anomaly', operator: 'gt', threshold: 0, sensitivity: cond.sensitivity }
    case 'relative':
      return { type: 'change_rate', operator: cond.direction === 'down' ? 'lt' : 'gt', threshold: 0, sensitivity: null }
    case 'absolute':
      return { type: 'threshold', operator: cond.operator, threshold: cond.threshold, sensitivity: null }
  }
}

/** One shape every screen renders a monitor's rule from — goal monitors and legacy rows alike. */
export type ConditionView =
  | { kind: 'absolute'; operator: AlertOp; threshold: number }
  | { kind: 'anomaly'; direction: Direction; sensitivity: number; window: number | null }
  | { kind: 'relative'; direction: 'down' | 'up'; pct: number; window: number }

export interface ConditionViewInput {
  type: string
  operator: string
  threshold: number
  sensitivity: number | null
  condition?: unknown
}

export function conditionViewOf(a: ConditionViewInput): ConditionView {
  const cond = parseCondition(a.condition)
  if (cond) {
    if (cond.strategy === 'anomaly') return { kind: 'anomaly', direction: cond.direction, sensitivity: cond.sensitivity, window: cond.window }
    if (cond.strategy === 'relative') return { kind: 'relative', direction: cond.direction, pct: cond.pct, window: cond.window }
    return { kind: 'absolute', operator: cond.operator, threshold: cond.threshold }
  }
  // legacy: anomaly = two-sided over the whole returned series
  if (a.type === 'anomaly') return { kind: 'anomaly', direction: 'both', sensitivity: a.sensitivity ?? 3, window: null }
  const op = (ALERT_OPS as readonly string[]).includes(a.operator) ? (a.operator as AlertOp) : 'gt'
  return { kind: 'absolute', operator: op, threshold: a.threshold }
}
