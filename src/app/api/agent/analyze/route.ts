import { auth } from '@trigger.dev/sdk'
import { getLocale } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { checkUsageQuota } from '@/lib/plans/usage'
import { taskIdForEngine } from '@/lib/agent/engine'
import { createAgentRun } from '@/lib/agent/create-run'
import { buildThreadPreamble, loadPriorTurns } from '@/lib/agent/thread-preamble'
import { isSqlEngine } from '@/lib/data-sources/engines'
import { userHasOrgRole } from '@/lib/org/require-role'
import { buildMonitorDraftQuestion } from '@/lib/alerts/draft'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * BFF for the analysis agent. Authenticates the user, confirms they're a member of the
 * data source's org (via RLS), creates the agent_runs row, triggers the Trigger.dev
 * `analyze` task, and returns a run id + a run-scoped public token the browser uses to
 * subscribe to the Realtime stream directly (no SSE relay through Vercel).
 *
 * `intent: 'monitor'` turns the same run into a goal → monitor DRAFT (docs/goal-monitors-plan.md):
 * the question is the operator's goal, the agent gets the drafting prompt + `propose_monitor`, and
 * the run is labelled `channel = 'monitor'`. Same auth, quota gate, dedupe and task — deliberately
 * NOT a new LLM entry point. Nothing is created here: the operator approves the draft afterwards
 * through the member-gated createAlert action.
 *
 * NOTE: this route holds NO database credentials / KMS — only TRIGGER_SECRET_KEY.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: { dataSourceId?: string; question?: string; priorRunIds?: string[]; intent?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const dataSourceId = body.dataSourceId?.trim()
  const question = body.question?.trim()
  if (!dataSourceId || !question) {
    return Response.json({ error: 'missing_fields' }, { status: 400 })
  }
  if (question.length > 4000) {
    return Response.json({ error: 'question_too_long' }, { status: 400 })
  }
  const draftingMonitor = body.intent === 'monitor'
  // the goal is stored on the monitor (alerts_goal_len_check caps it at 500)
  if (draftingMonitor && question.length > 500) {
    return Response.json({ error: 'goal_too_long' }, { status: 400 })
  }

  // RLS: the data source is visible only to members of its org → membership check + org_id
  const { data: dsRows, error: dsErr } = await supabase
    .from('data_sources')
    .select('id, org_id, status, engine')
    .eq('id', dataSourceId)
    .is('deleted_at', null)
    .limit(1)
  if (dsErr) return Response.json({ error: 'lookup_failed' }, { status: 500 })
  if (!dsRows || dsRows.length === 0) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const dsRow = dsRows[0] as { org_id: string; engine: string }
  const orgId = dsRow.org_id
  // route document sources (Firestore) to their own task; SQL sources to `analyze`.
  const taskId = taskIdForEngine(dsRow.engine)
  if (draftingMonitor) {
    // monitors evaluate SQL only, and only a member+ can create one — a draft a viewer can never
    // approve would just spend the org's quota
    if (!isSqlEngine(dsRow.engine)) return Response.json({ error: 'sql_only' }, { status: 400 })
    if (!(await userHasOrgRole(supabase, orgId, user.id, ['owner', 'admin', 'member']))) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  // Metered quota gate (billing) — also the cost-abuse guard: LLM runs are otherwise
  // unbounded. Blocks when the org is over its monthly query/token budget for its plan.
  const quota = await checkUsageQuota(orgId, { locale: await getLocale() })
  if (!quota.allowed) {
    return Response.json(
      { error: 'quota_exceeded', reason: quota.reason, limitType: quota.limitType, usage: quota },
      { status: 402 },
    )
  }

  const admin = requireAdminClient()

  // Thread continuity: build a context preamble from prior turns for the AGENT only.
  // agent_runs.question keeps the RAW question (clean history/display); the preamble rides
  // solely in the trigger payload so follow-ups continue the conversation. Shared with the
  // local-dev SSE route (thread-preamble.ts) so both transports thread identically.
  // A drafting run is never a thread follow-up: the agent sees only the framed goal.
  const priorIds =
    !draftingMonitor && Array.isArray(body.priorRunIds)
      ? body.priorRunIds.filter((x): x is string => typeof x === 'string')
      : []
  const priorTurns = await loadPriorTurns(admin, { orgId, dataSourceId, priorRunIds: priorIds })
  const effectiveQuestion = draftingMonitor ? buildMonitorDraftQuestion(question) : buildThreadPreamble(priorTurns, question)

  // Shared: double-submit guard → insert agent_runs → trigger the engine task.
  const created = await createAgentRun({
    orgId,
    dataSourceId,
    userId: user.id,
    question,
    channel: draftingMonitor ? 'monitor' : 'web',
    taskId,
    agentQuestion: effectiveQuestion,
    payloadExtra: draftingMonitor
      ? { locale: await getLocale(), intent: 'monitor', goal: question }
      : { locale: await getLocale() },
  })
  switch (created.status) {
    case 'duplicate':
      return Response.json({ error: 'duplicate_run', runId: created.runId }, { status: 409 })
    case 'insert_failed':
      return Response.json({ error: 'run_create_failed' }, { status: 500 })
    case 'no_worker':
      // LOCAL-DEV: no Trigger.dev configured → the browser runs it inline via the SSE stream route.
      return Response.json({ mode: 'local', runId: created.runId })
    case 'trigger_failed':
      return Response.json({ error: 'trigger_failed' }, { status: 502 })
  }

  // run-scoped public token: the browser subscribes to ONLY this run's stream. Lifetime is
  // set longer than the task maxDuration (3600s) so a long run's stream isn't cut off near
  // the end; the token only grants read on this single run id.
  const publicToken = await auth.createPublicToken({
    scopes: { read: { runs: [created.triggerRunId] } },
    expirationTime: '2h',
  })

  return Response.json({ mode: 'trigger', runId: created.runId, triggerRunId: created.triggerRunId, publicToken })
}
