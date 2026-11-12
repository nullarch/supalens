// @sentry/node (NOT @sentry/nextjs): this module is bundled into the Trigger.dev tasks
// (analyze / analyze-firestore / analyze-code / messenger-answer), whose host inits Sentry via
// @sentry/node in trigger/sentry.ts. @sentry/nextjs here would report through an SDK never
// initialized on that host, silently dropping agent_runs write failures. Same convention as
// usage.ts / webhook-handlers.ts / email/alert.ts.
import * as Sentry from '@sentry/node'

import { createAdminClient } from '@/utils/supabase/admin'
import { sendFirstAnalysisToHub } from '@/lib/event-hub/events'
import { incrementUsage } from '@/lib/plans/usage'
import type { AnalysisResult } from './run-analysis'

/** Shared agent_runs lifecycle writes (used by both the Trigger task and the local SSE path). */

/**
 * Claim a queued run as running. Guarded to 'queued' only — without the filter a task starting
 * late (after the user cancelled, or after the stuck-run reaper failed the row) would resurrect
 * a terminal run to 'running', letting persistRun's guard match and METER a cancelled run.
 * Returns whether THIS caller claimed it (false → someone else owns it / it's terminal), which
 * the local SSE route uses to break its concurrent-GET double-execution race.
 */
export async function markRunning(runId: string): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return true // unconfigured local fallback — behave as before
  const { data, error } = await admin
    .from('agent_runs')
    .update({ status: 'running' })
    .eq('id', runId)
    .in('status', ['queued'])
    .select('id')
  if (error) {
    console.error(`[agent] markRunning failed for ${runId}:`, error.message)
    Sentry.captureException(error, { tags: { runId } })
    return false
  }
  return Boolean(data?.length)
}

/**
 * Persist a terminal FAILED run so the row never sticks at 'running'. Centralizes the
 * empty-AnalysisResult shape that every transport (analyze / analyze-firestore / SSE /
 * messenger-answer) used to inline — so a new AnalysisResult field can't drift across copies.
 */
export async function persistFailedRun(runId: string, err: unknown): Promise<void> {
  await persistRun(runId, {
    ok: false,
    text: '',
    turns: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    visualizations: [],
    error: String(err).slice(0, 300),
  })
}

export async function persistRun(runId: string, result: AnalysisResult): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { data, error } = await admin
    .from('agent_runs')
    .update({
      status: result.ok ? 'succeeded' : 'failed',
      result: {
        text: result.text,
        visualizations: result.visualizations,
        // goal → monitor drafting runs: the draft survives a reload (/app/monitors?draft=<runId>)
        ...(result.monitorDraft ? { monitor_draft: result.monitorDraft } : {}),
      },
      turns: result.turns,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd,
      error: result.error ?? null,
      ended_at: new Date().toISOString(),
    })
    .eq('id', runId)
    // Only finalize a live run. Without this guard a task finishing right after the user
    // cancelled (or after the stuck-run reaper fired) would resurrect the terminal row to
    // 'succeeded' AND meter usage for a run the user cancelled — every other status writer
    // (cancel route, reaper) carries the same filter. 0 rows matched → no metering below.
    .in('status', ['queued', 'running'])
    .select('org_id, data_source_id, user_id')
    .maybeSingle()
  if (error) {
    console.error(`[agent] persistRun failed for ${runId}:`, error.message)
    Sentry.captureException(error, { tags: { runId } })
    return
  }
  // Meter usage for billing (1 query + total tokens this run). Single convergence point for
  // SQL + Firestore across the Trigger + local-SSE transports. Demo runs are EXCLUDED from the
  // monthly plan quota (the daily abuse cap still bounds them). Best-effort — never blocks the run.
  const row = data as { org_id: string; data_source_id: string | null; user_id?: string | null } | null
  const orgId = row?.org_id
  if (orgId) {
    let isDemo = false
    if (row?.data_source_id) {
      const { data: dsRows } = await admin.from('data_sources').select('is_demo').eq('id', row.data_source_id).limit(1)
      isDemo = Boolean((dsRows?.[0] as { is_demo?: boolean } | undefined)?.is_demo)
    }
    if (!isDemo) {
      const tokens = (result.tokensIn ?? 0) + (result.tokensOut ?? 0)
      // Through the incrementUsage WRAPPER, not the raw RPC — the wrapper owns the 80%/100%
      // quota emails (once per period), and this is the main metering path. Never throws.
      await incrementUsage(orgId, 1, tokens)
      // This update won the live-run guard above, so a cancelled or reaped run never gets here.
      if (result.ok && row?.user_id) await sendFirstAnalysisToHub(admin, row.user_id, runId)
    }
  }
}
