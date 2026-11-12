// NOT `import 'server-only'` — runs on the Trigger.dev host (agent + admin client), same convention
// as alerts/runner.ts. Root-cause enrichment for a firing alert: reuse the read-only analysis agent
// (runAnalysis) to investigate WHY, persist the explanation onto the alert_event, and send the
// ENRICHED notification. The agent auto-injects the data source's SUPALENS.md context, so for a
// repo-attached source it can connect the metric change to recent code/behavior — the differentiated
// bit no commodity alerter has. Falls back to the plain template email if the agent fails.
import { randomUUID } from 'crypto'

import { runAnalysis, type AnalysisResult } from '@/lib/agent/run-analysis'
import { SYSTEM_RUN_MODEL } from '@/lib/agent/models'
import { persistRun } from '@/lib/agent/run-record'
import { isMissingColumnError } from '@/lib/agent/run-channel'
import { requireAdminClient } from '@/utils/supabase/admin'
import { checkUsageQuota, incrementUsage } from '@/lib/plans/usage'
import { sendAlertEmail } from '@/lib/email/alert'
import { notifyChannels } from '@/lib/notify/dispatch'
import { recipientsDetailFor, orgNameOf } from './runner'
import type { AlertOp } from './evaluate'

export interface ExplainAlertArgs {
  alertId: string
  eventId: string | null
  orgId: string
  dataSourceId: string
  alertName: string
  metricSql: string
  value: number
  operator: AlertOp
  threshold: number
  /** anomaly alerts are threshold-less → the email suppresses the `value > 0` condition box. */
  isAnomaly?: boolean
  /** goal monitors: the operator's own words ("tell me when signups dip") — frames the investigation. */
  goal?: string | null
  message: string
  runId: string
  model?: string
  /** org locale (resolved by the runner) — explanation + email use it. */
  locale?: string
}

function buildQuestion(a: ExplainAlertArgs): string {
  return `An alert just FIRED. Explain WHY it fired, for a notification to a busy operator.

Alert: "${a.alertName}"${a.goal ? `
The operator's goal for this monitor, in their words: "${a.goal}"` : ''}
Metric query: ${a.metricSql}
Current value: ${a.value}
Condition met: ${a.message}

Investigate the DATA to find the probable cause. Break the metric down along the most relevant dimensions with small, targeted SELECTs — day-over-day / week-over-week, by segment/category, top contributing entities — to see WHAT actually moved. Use any schema / business / code context available to you to connect the movement to a likely driver.

Then write a concise probable-cause explanation (3-5 sentences) for someone who needs to act:
- Lead with the single MOST likely cause.
- Cite concrete numbers you found (before→after, which segment/entity).
- Separate what you CONFIRMED in the data from a hypothesis ("likely" / "possibly").
- If the data genuinely cannot explain it, say so — do NOT fabricate.
Output ONLY the explanation prose (no preamble, no headings).`
}

/**
 * The history label for an investigation. `buildQuestion` is a full prompt — storing THAT as
 * `agent_runs.question` would make the run history unreadable, so the row carries this short
 * line and the agent gets the prompt (the same split `createAgentRun` models with
 * `question` vs `agentQuestion`).
 */
function runLabel(a: ExplainAlertArgs): string {
  return `Why did "${a.alertName}" fire?`
}

/**
 * Open an `agent_runs` row for this investigation, so a root-cause run is a first-class run:
 * it shows up in the history with `channel = 'incident'`, `alert_events.explanation_run_id`
 * finally points somewhere, and — the part that actually matters — `persistRun` meters its
 * tokens like every other LLM path.
 *
 * Best-effort by design: this is a notification path that must not be blocked by a bookkeeping
 * failure, so a fault here returns null and the caller falls back to metering directly.
 */
async function openInvestigationRun(args: ExplainAlertArgs): Promise<string | null> {
  const admin = requireAdminClient()
  const runId = randomUUID()
  const baseRow = {
    id: runId,
    org_id: args.orgId,
    data_source_id: args.dataSourceId,
    user_id: null, // a monitor fired this, not a person
    question: runLabel(args),
    // Inserted RUNNING, not queued: nothing will dispatch it — we are already executing.
    // persistRun only finalizes rows in ('queued','running'), so this is what lets it close.
    status: 'running',
  }
  try {
    // `channel` may not be migrated yet → retry without it (fail-open, as in create-run.ts).
    let err = (await admin.from('agent_runs').insert({ ...baseRow, channel: 'incident' })).error
    if (err && isMissingColumnError(err)) {
      err = (await admin.from('agent_runs').insert(baseRow)).error
    }
    if (err) {
      console.error(`[alerts] could not open investigation run for ${args.alertId}:`, err.message)
      return null
    }
    return runId
  } catch (e) {
    console.error(`[alerts] could not open investigation run for ${args.alertId}:`, e)
    return null
  }
}

/**
 * Run the root-cause analysis for a firing alert, persist it on the event, and send the enriched
 * notification. Never throws (the alert row + event are already committed); a failed agent run still
 * sends the plain fallback email. Returns whether the explanation and the send succeeded.
 */
export async function runAlertExplanation(args: ExplainAlertArgs): Promise<{ ok: boolean; sent: boolean }> {
  const admin = requireAdminClient()

  let explanation = ''
  let ok = false
  // LLM entry point → the usage-quota gate applies (the maintenance invariant). An org over
  // budget still gets the PLAIN alert notification below — only the LLM enrichment is skipped.
  let quotaOk = true
  try {
    quotaOk = (await checkUsageQuota(args.orgId)).allowed
  } catch {
    /* quota check is best-effort — never block the notification path */
  }
  let investigationRunId: string | null = null
  if (quotaOk) {
    // Open the run record BEFORE the agent starts, so an investigation that crashes mid-way still
    // leaves a row the history can show as failed instead of vanishing.
    investigationRunId = await openInvestigationRun(args)
    let result: AnalysisResult | null = null
    try {
      const res = await runAnalysis({
        orgId: args.orgId,
        dataSourceId: args.dataSourceId,
        userId: 'system',
        // Bind the agent's run id to the row we just opened when we have one, so the row, the
        // agent's own logging and alert_events.explanation_run_id all name the same run.
        runId: investigationRunId ?? args.runId,
        question: buildQuestion(args),
        locale: args.locale,
        maxTurns: 14,
        maxTotalTokens: 300_000,
        // root-cause summarization → cheaper model (system run, best-effort)
        model: args.model ?? SYSTEM_RUN_MODEL,
      })
      result = res
      if (res.ok && res.text.trim()) {
        explanation = res.text.trim()
        ok = true
      }
    } catch (e) {
      console.error(`[alerts] root-cause analysis failed for ${args.alertId}:`, e)
      result = {
        ok: false,
        text: '',
        turns: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
        visualizations: [],
        error: String(e).slice(0, 300),
      }
    }
    // Meter EXACTLY ONCE. Until now this path gated on quota but never incremented, so a busy
    // monitor's investigations were invisible to billing and the gate only ever reflected other
    // paths' usage. persistRun is the single metering convergence point (it also skips demo
    // sources and writes the terminal status); when the row could not be opened we increment
    // directly so the fallback still counts — the two branches are mutually exclusive.
    if (investigationRunId) {
      await persistRun(investigationRunId, result)
    } else if (result) {
      await incrementUsage(args.orgId, 1, (result.tokensIn ?? 0) + (result.tokensOut ?? 0))
    }
  } else {
    console.warn(`[alerts] org ${args.orgId} over quota — sending plain alert without root-cause analysis`)
  }

  if (args.eventId) {
    // explanation_run_id now points at a real agent_runs row (openInvestigationRun above), which
    // is what lets the incident detail and the run history link to the investigation. It stays
    // null when the row could not be opened — never a dangling uuid.
    await admin
      .from('alert_events')
      .update({
        explanation: explanation || null,
        explained: true,
        ...(investigationRunId ? { explanation_run_id: investigationRunId } : {}),
      })
      .eq('id', args.eventId)
  }

  // notify — enriched when we have an explanation, the plain template otherwise
  const to = await recipientsDetailFor(args.orgId, 'alert')
  const orgName = await orgNameOf(args.orgId)
  const r = await sendAlertEmail({
    to,
    orgId: args.orgId,
    kind: 'fired',
    alertName: args.alertName,
    orgName,
    value: args.value,
    operator: args.operator,
    threshold: args.threshold,
    isAnomaly: args.isAnomaly,
    goal: args.goal ?? null,
    message: args.message,
    locale: args.locale,
    explanation: explanation || undefined,
    alertId: args.alertId,
    eventId: args.eventId,
  })
  if (args.eventId) await admin.from('alert_events').update({ notified: r.sent }).eq('id', args.eventId)
  await notifyChannels(args.orgId, {
    kind: 'fired',
    alertName: args.alertName,
    message: args.message,
    explanation: explanation || undefined,
    locale: args.locale,
    alertId: args.alertId,
    eventId: args.eventId,
  })
  return { ok, sent: r.sent }
}
