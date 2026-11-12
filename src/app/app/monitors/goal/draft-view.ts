/**
 * Goal → monitor drafting: the pure view logic behind the composer and the approval card.
 * No React, no io — the stream chunks and a draft go in, what the screen says comes out, so the
 * numbers the operator approves against (usual range, backtest, "would fire now") are pinned by
 * tests rather than recomputed ad hoc in JSX.
 */
import {
  backtestCondition,
  dropInProgress,
  evaluateCondition,
  seriesPointsFromRows,
  type BacktestResult,
  type ConditionEval,
  type MonitorCondition,
  type SeriesPoint,
} from '@/lib/alerts/condition'
import { parseMonitorDraft, type MonitorDraft } from '@/lib/alerts/draft'

/** The agent chunk shapes this view reads (a subset of AnalysisChunk, kept structural). */
export type DraftChunk =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tool: string; input?: unknown }
  | { type: 'monitor_draft'; draft: unknown }
  | { type: 'status'; status: string }
  | { type: string; [k: string]: unknown }

export type DraftStage = 'start' | 'schema' | 'query' | 'propose'

/** How far the agent got — drives the three-step progress line while it works. */
export function draftStage(chunks: DraftChunk[]): DraftStage {
  let stage: DraftStage = 'start'
  const rank: Record<DraftStage, number> = { start: 0, schema: 1, query: 2, propose: 3 }
  for (const c of chunks) {
    if (c.type !== 'tool_use') continue
    const tool = String((c as { tool?: unknown }).tool ?? '')
    const next: DraftStage | null = tool.endsWith('propose_monitor')
      ? 'propose'
      : tool.endsWith('execute_sql')
        ? 'query'
        : tool.endsWith('get_schema')
          ? 'schema'
          : null
    if (next && rank[next] > rank[stage]) stage = next
  }
  return stage
}

/** The latest accepted draft on the stream (a re-proposal replaces the earlier one). */
export function latestDraft(chunks: DraftChunk[]): MonitorDraft | null {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i]
    if (c.type === 'monitor_draft') {
      const d = parseMonitorDraft((c as { draft?: unknown }).draft)
      if (d) return d
    }
  }
  return null
}

/** The agent's closing prose — shown when a run ends WITHOUT a draft, so the operator sees why. */
export function finalText(chunks: DraftChunk[]): string {
  return chunks
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text' && typeof (c as { text?: unknown }).text === 'string')
    .map((c) => c.text)
    .join('')
    .trim()
}

export interface DraftPreview {
  /** complete daily points (the in-progress day removed) */
  points: SeriesPoint[]
  /** per point: the usual range the rule expected BEFORE that day (null while learning) */
  bands: Array<{ lower: number | null; upper: number | null } | null>
  current: ConditionEval
  backtest: BacktestResult
  firedBuckets: string[]
}

/**
 * Everything the approval card shows, from the draft's own sample and the condition the operator
 * is currently looking at (the slider edits the condition, not the draft). Null when the sample
 * has no usable points.
 */
export function buildDraftPreview(
  draft: Pick<MonitorDraft, 'sample'>,
  condition: MonitorCondition,
  nowMs: number,
  timezone: string,
): DraftPreview | null {
  const all = seriesPointsFromRows(draft.sample.columns, draft.sample.rows)
  const { points } = dropInProgress(all, nowMs, timezone)
  if (points.length === 0) return null
  const values = points.map((p) => p.value)
  const bands = values.map((_, i) => {
    const ev = evaluateCondition(values, condition, i + 1)
    return ev.insufficient || (ev.lower === null && ev.upper === null) ? null : { lower: ev.lower, upper: ev.upper }
  })
  const backtest = backtestCondition(values, condition)
  return {
    points,
    bands,
    current: evaluateCondition(values, condition),
    backtest,
    firedBuckets: backtest.firedIndices.map((i) => points[i]?.bucket).filter((b): b is string => Boolean(b)),
  }
}

/** Default parameters when the operator switches the rule's strategy on the card. */
export function switchStrategy(from: MonitorCondition, to: MonitorCondition['strategy'], current: ConditionEval | null): MonitorCondition {
  if (from.strategy === to) return from
  const direction = from.strategy === 'absolute' ? 'down' : from.direction === 'up' ? 'up' : 'down'
  if (to === 'anomaly') return { v: 1, strategy: 'anomaly', direction: from.strategy === 'anomaly' ? from.direction : direction, sensitivity: 3, window: 28 }
  if (to === 'relative') return { v: 1, strategy: 'relative', direction, pct: 0.3, window: 7 }
  // absolute: start from the edge of today's usual range so the number is grounded in the data,
  // but it is the OPERATOR who confirms it — the model never picks it
  const seed = direction === 'up' ? current?.upper ?? current?.latest : current?.lower ?? current?.latest
  return { v: 1, strategy: 'absolute', operator: direction === 'up' ? 'gt' : 'lt', threshold: roundNice(seed ?? 0) }
}

/** 2 significant digits — a threshold the operator reads, not a computed artifact. */
export function roundNice(n: number): number {
  if (!Number.isFinite(n) || n === 0) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - 1)
  return Math.round(n / mag) * mag
}

/**
 * The usual-range edge as the operator should READ it. For a count (every point an integer) the
 * exact integer edge is shown: "below 25.42" fires on 25 or less, i.e. "below 26"; "above 71.8"
 * fires on 72 or more, i.e. "above 71". Other series keep their value.
 */
export function readableBound(v: number, side: 'lower' | 'upper', integerSeries: boolean): number {
  if (!integerSeries) return v
  // the edge itself fires (z ≤ −k / z ≥ k), so an integer edge belongs to the alert side too
  return side === 'lower' ? Math.floor(v) + 1 : Math.ceil(v) - 1
}

export function isIntegerSeries(points: SeriesPoint[]): boolean {
  return points.length > 0 && points.every((p) => Number.isInteger(p.value))
}
