// Boot-time cleanup for the built-in backend. The queue lives in memory, so whatever a previous
// process left queued or running can never finish. Mark it failed now: a stale in-flight row
// otherwise blocks the same question (the duplicate guard) until the nightly reaper's 2h cutoff.
import { createAdminClient } from '@/utils/supabase/admin'

const REASON = 'interrupted by a server restart'

export async function reapInterruptedRuns(): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const now = new Date().toISOString()
  let reaped = 0
  const sweep = async (table: string, from: string[], patch: Record<string, unknown>) => {
    try {
      const { count, error } = await admin.from(table).update(patch, { count: 'exact' }).in('status', from)
      if (error) throw error
      reaped += count ?? 0
    } catch (error) {
      // a missing table/column on an older schema must not stop the server from starting
      console.warn(`[tasks] could not reap ${table}:`, error instanceof Error ? error.message : error)
    }
  }
  await sweep('agent_runs', ['queued', 'running'], { status: 'failed', error: REASON, ended_at: now })
  await sweep('code_analysis_runs', ['queued', 'running'], { status: 'failed', error: REASON, ended_at: now })
  await sweep('kpi_extractions', ['running'], { status: 'failed', error: REASON })
  await sweep('data_source_context', ['generating'], { status: 'failed' })
  if (reaped > 0) console.log(`[tasks] marked ${reaped} interrupted run(s) as failed`)
  return reaped
}
