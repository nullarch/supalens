// @sentry/node (NOT @sentry/nextjs): this module is bundled into the Trigger.dev code-analysis
// task, whose host inits Sentry via @sentry/node in trigger/sentry.ts. @sentry/nextjs here would
// report through an SDK never initialized on that host, silently dropping code_analysis_runs write
// failures. Same convention as usage.ts / webhook-handlers.ts / email/alert.ts.
import * as Sentry from '@sentry/node'

import { createAdminClient } from '@/utils/supabase/admin'
import { incrementUsage } from '@/lib/plans/usage'
import type { CodeAnalysisResult } from './run-code-analysis'

/** code_analysis_runs lifecycle writes (mirror of agent/run-record.ts). service_role only. */

export async function markCodeRunning(runId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  // 'queued' only — a late-starting task must not resurrect a cancelled/reaped run
  // (mirrors agent/run-record.ts markRunning).
  const { error } = await admin
    .from('code_analysis_runs')
    .update({ status: 'running' })
    .eq('id', runId)
    .in('status', ['queued'])
  if (error) {
    console.error(`[code-agent] markCodeRunning failed for ${runId}:`, error.message)
    Sentry.captureException(error, { tags: { runId } })
  }
}

export async function persistCodeRun(runId: string, result: CodeAnalysisResult): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { data, error } = await admin
    .from('code_analysis_runs')
    .update({
      status: result.ok ? 'succeeded' : 'failed',
      result: { text: result.text },
      turns: result.turns,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd,
      error: result.error ?? null,
      ended_at: new Date().toISOString(),
    })
    .eq('id', runId)
    // Only finalize a live run (same guard as agent/run-record.ts persistRun). Without it a
    // reaper-failed run would resurrect to 'succeeded', and the analyze-code catch-path's second
    // persist after a success-path fault would double-meter usage. 0 rows matched → no metering.
    .in('status', ['queued', 'running'])
    .select('org_id')
    .maybeSingle()
  if (error) {
    console.error(`[code-agent] persistCodeRun failed for ${runId}:`, error.message)
    Sentry.captureException(error, { tags: { runId } })
    return
  }
  // Meter usage for billing (code analysis also burns the host Anthropic key). Through the
  // incrementUsage WRAPPER, not the raw RPC — the wrapper owns the 80%/100% quota emails.
  const orgId = (data as { org_id: string } | null)?.org_id
  if (orgId) {
    const tokens = (result.tokensIn ?? 0) + (result.tokensOut ?? 0)
    await incrementUsage(orgId, 1, tokens)
  }
}
