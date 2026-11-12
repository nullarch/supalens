import { runs } from '@trigger.dev/sdk'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cancel an in-flight analysis run. Membership is proven by the RLS read (the run
 * row is only visible to its org's members); the status write goes through the
 * admin client (agent_runs writes are service_role-only). On the Trigger path the
 * remote run is cancelled too; the local-dev SSE path just flips the row (the
 * stream loop checks status between turns at best-effort).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('agent_runs')
    .select('id, status, trigger_run_id')
    .eq('id', id)
    .limit(1)
  const run = data?.[0] as { status: string; trigger_run_id: string | null } | undefined
  if (!run) return Response.json({ error: 'not_found' }, { status: 404 })
  if (run.status !== 'queued' && run.status !== 'running') {
    return Response.json({ ok: true, status: run.status }) // already terminal — idempotent
  }

  if (run.trigger_run_id && process.env.TRIGGER_SECRET_KEY) {
    try {
      await runs.cancel(run.trigger_run_id)
    } catch (err) {
      // remote cancel is best-effort; the row still flips so the UI/quota reflect intent
      console.warn(`[agent] trigger cancel failed for ${run.trigger_run_id}:`, err)
    }
  }

  const admin = requireAdminClient()
  await admin
    .from('agent_runs')
    .update({ status: 'cancelled', ended_at: new Date().toISOString(), error: 'cancelled by user' })
    .eq('id', id)
    .in('status', ['queued', 'running'])

  return Response.json({ ok: true, status: 'cancelled' })
}
