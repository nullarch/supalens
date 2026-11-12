// NOT `import 'server-only'` — imported by trigger/generate-context.ts and the unified
// onboarding scan, both of which run on the Trigger.dev host.
//
// Daily-cap accounting for a tier-2 context generation. checkUsageQuota's billing-independent
// MAX_RUNS_PER_ORG_PER_DAY counts agent_runs + code_analysis_runs + kpi_extractions; context
// generation persists only a `data_source_context` row, so without this record it would pass the
// gate but never raise the counter — an unbounded free clone+LLM loop.
//
// Deliberately NOT finalized through `persistCodeRun`, which would double-meter: monthly metering
// stays in runContextGeneration's `incrementUsage`.
import { createAdminClient } from '@/utils/supabase/admin'

export interface ContextRunRecordArgs {
  runId: string
  orgId: string
  repoId: string
  dataSourceId: string
  userId?: string
  ref?: string
}

/** Insert the `kind='context'` run row. Best-effort: accounting must never sink the run. */
export async function openContextRunRow(args: ContextRunRecordArgs): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { error } = await admin.from('code_analysis_runs').insert({
    id: args.runId,
    org_id: args.orgId,
    repo_id: args.repoId,
    data_source_id: args.dataSourceId,
    user_id: args.userId ?? null,
    kind: 'context',
    status: 'running',
    ref: args.ref ?? null,
  })
  if (error) console.error(`[context] run-row insert failed for ${args.runId}:`, error.message)
}

/** Stamp the terminal state on the run row. Guarded by the status filter so a late call cannot
 *  reopen a row another path already closed. */
export async function closeContextRunRow(runId: string, ok: boolean, error?: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { error: e } = await admin
    .from('code_analysis_runs')
    .update({
      status: ok ? 'succeeded' : 'failed',
      error: error?.slice(0, 300) ?? null,
      ended_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .in('status', ['queued', 'running'])
  if (e) console.error(`[context] run-row finalize failed for ${runId}:`, e.message)
}
