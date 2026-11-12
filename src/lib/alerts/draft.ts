/**
 * Goal → monitor drafting (docs/goal-monitors-plan.md) — the pure half.
 *
 * The operator types a goal ("tell me when signups dip"); the read-only analysis agent explores the
 * schema, runs a daily series through `execute_sql`, and calls `propose_monitor` with a structured
 * rule. This module holds that tool's contract + validator (no MCP / agent / DB imports — it reads
 * only the in-process result store, like propose_kpi), the drafting prompt, and the draft shape the
 * stream / persistence / UI share.
 *
 * Accuracy is structural, same as KPI extraction and X-ray: the SQL is bound from a query that
 * actually ran (queryId), the series shape is proven evaluable (goal-series.ts), and every number
 * the approval screen shows — baseline, expected range, backtest — is computed by code from the
 * sample, never written by the model.
 *
 * Shared with the Trigger.dev runtime and the browser — no `import 'server-only'`.
 */
import { z } from 'zod'

import { FormatSchema } from '@/lib/viz/spec'
import { MonitorCondition } from './condition'
import { checkGoalSeries, DAILY_SERIES_EXAMPLE } from './goal-series'

/** Rows of the series kept on the draft for the approval preview (≈ 6 months of days). */
export const DRAFT_SAMPLE_MAX_ROWS = 200

/** Raw zod shape for the in-process `propose_monitor` tool. */
export const ProposeMonitorInput = {
  queryId: z.string().min(1).describe('the queryId execute_sql returned for the DAILY series'),
  name: z.string().min(1).max(60).describe('short noun phrase naming the metric, in the language the goal is written in, e.g. "Daily signups"'),
  condition: MonitorCondition,
  rationale: z
    .string()
    .min(1)
    .max(400)
    .describe('1–2 plain sentences, in the language the goal is written in: what data this watches and why this rule fits the goal'),
  format: FormatSchema.optional().describe('how to render the measure (currency / percent / number + unit)'),
}

export const MonitorDraft = z.object({
  name: z.string(),
  /** the operator's words — set by the HOST from the run, never by the model */
  goal: z.string(),
  metricSql: z.string(),
  condition: MonitorCondition,
  rationale: z.string(),
  format: FormatSchema.optional(),
  sample: z.object({ columns: z.array(z.string()), rows: z.array(z.record(z.string(), z.unknown())) }),
})
export type MonitorDraft = z.infer<typeof MonitorDraft>

export function parseMonitorDraft(raw: unknown): MonitorDraft | null {
  const parsed = MonitorDraft.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Host-side context for a drafting run: where the accepted draft goes. */
export interface MonitorDraftSink {
  goal: string
  /** the org's zone — the series check skips the day still in progress there */
  timezone: string
  onDraft: (draft: MonitorDraft) => void | Promise<void>
}

export interface StashedQuery {
  sql: string
  columns: string[]
  rows: Record<string, unknown>[]
}

export type ProposeMonitorArgs = z.infer<ReturnType<typeof z.object<typeof ProposeMonitorInput>>>

/**
 * Validate a monitor proposal against the stashed result its queryId references. Returns the
 * SQL-bound draft, or a self-repair error string for the model.
 */
export function validateMonitorProposal(
  store: Pick<Map<string, StashedQuery>, 'get'>,
  sink: Pick<MonitorDraftSink, 'goal' | 'timezone'>,
  input: ProposeMonitorArgs,
  nowMs: number,
): { ok: true; draft: MonitorDraft; summary: string } | { ok: false; error: string } {
  const q = store.get(input.queryId)
  if (!q) {
    return { ok: false, error: `Unknown queryId "${input.queryId}". Run execute_sql with the daily series first and use the queryId it returns.` }
  }
  const checked = checkGoalSeries(q.columns, q.rows, input.condition, nowMs, sink.timezone)
  if (!checked.ok) return { ok: false, error: checked.error }
  const { current, backtest, points } = checked.check
  const draft: MonitorDraft = {
    name: input.name.trim(),
    goal: sink.goal,
    metricSql: q.sql,
    condition: input.condition,
    rationale: input.rationale.trim(),
    ...(input.format ? { format: input.format } : {}),
    sample: { columns: q.columns, rows: q.rows.slice(-DRAFT_SAMPLE_MAX_ROWS) },
  }
  // The model gets the backtest back so a rule that would page every other day can be reconsidered
  // before the operator ever sees it.
  const summary =
    `Monitor draft accepted. Over the last ${points.length} days this rule would have fired ${backtest.fires} time(s)` +
    `; latest day ${points[points.length - 1]?.bucket} = ${current.latest}${current.met ? ' (would fire now)' : ''}.` +
    (backtest.fires > Math.max(3, points.length / 10)
      ? ' That is noisy — consider a looser sensitivity / larger pct and propose again.'
      : '')
  return { ok: true, draft, summary }
}

/** TRUSTED system-prompt section appended for drafting runs (the goal itself is the user turn). */
export const MONITOR_DRAFT_PROMPT = `

## Monitor drafting mode

The user message is a GOAL — something they want to be alerted about — not a question. Your job is to draft ONE monitor that watches it and register it with \`propose_monitor\`. Do not answer with an analysis and do not propose charts.

1. \`get_schema\`, then find the table and column that actually measure the goal (prefer business tables — users, orders, payments, subscriptions — over logs).
2. Write a DAILY series for the last 90 days: one row per calendar day, oldest → newest, the day FIRST and the numeric measure LAST. Build the day axis with generate_series and LEFT JOIN, so a day with no activity is 0 (otherwise a drop to zero could never fire), and end it at current_date - 1 — today is still in progress:
   ${DAILY_SERIES_EXAMPLE}
   For a rate, compute it per day with a safe denominator (nullif(…, 0)) and coalesce empty days sensibly.
3. \`execute_sql\` it and look at the numbers: typical level, day-to-day spread, zeros, weekly pattern.
4. Pick the rule from the user's WORDS:
   - no number and no comparison ("dips", "drops", "stops", "spikes", "looks off") → \`anomaly\`: direction "down" for dips / drops / stops, "up" for spikes / surges / increases, "both" only when the goal names neither; sensitivity 3 (2.5 if they want to hear early, 4 if they only care about big moves); window 28.
   - a comparison ("30% below last week", "half of yesterday") → \`relative\`: direction, pct as a FRACTION (0.3 = 30%), window = the trailing days averaged (7 for "last week's average", 1 for "yesterday").
   - a number the user GAVE, or a hard natural bound of the metric ("error rate above 5%", "any failed payment" → gt 0) → \`absolute\`.
   NEVER invent an absolute number the user did not give. If you are tempted to, use \`anomaly\` — it learns the normal range from the data.
5. Call \`propose_monitor\` with the queryId, a short \`name\` (a noun phrase naming the metric, e.g. "Daily signups" — not a sentence), the \`condition\` (v: 1), a 1–2 sentence \`rationale\`, and a \`format\` for the measure. Write the name and the rationale in the SAME language the goal is written in. The rationale is read by the operator: say which data you watch and why this kind of rule fits their words, in plain language — never field names, JSON or words like "strategy", "direction", "pct", "window". It replies with a backtest; if it says the rule is noisy, loosen it and propose again. If it rejects the series, fix the SQL as the error says.
6. End with ONE short sentence describing the monitor.`

/** The user turn of a drafting run: the goal, verbatim, framed as a goal. */
export function buildMonitorDraftQuestion(goal: string): string {
  return `Monitor goal (the user's words): "${goal.replace(/"/g, "'")}"\nDraft the monitor.`
}
