import { getLocale } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'
import { type AnalysisChunk } from '@/lib/agent/run-analysis'
import { markRunning, persistRun, persistFailedRun } from '@/lib/agent/run-record'
import { runByEngine } from '@/lib/agent/run-by-engine'
import { buildThreadPreamble, loadPriorTurns } from '@/lib/agent/thread-preamble'
import { isMissingColumnError } from '@/lib/agent/run-channel'
import { buildMonitorDraftQuestion } from '@/lib/alerts/draft'
import { getOrgTimezone } from '@/lib/org/timezone'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * LOCAL-DEV agent execution path. When Trigger.dev is NOT configured, the browser opens
 * this SSE stream and the agent runs INLINE in the Node dev server (which is long-running,
 * unlike Vercel serverless). In production set TRIGGER_SECRET_KEY so the agent runs on
 * Trigger.dev instead — this route then refuses (the Agent SDK subprocess + long loop must
 * not run on a serverless function).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (process.env.TRIGGER_SECRET_KEY) {
    return Response.json({ error: 'use_trigger_in_production' }, { status: 400 })
  }

  const supabase = await createClient()
  if (!supabase) return Response.json({ error: 'supabase_not_configured' }, { status: 500 })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const admin = requireAdminClient()
  // `channel` names a goal → monitor drafting run; it may not be migrated yet → retry without it.
  const readRun = (withChannel: boolean) =>
    admin
      .from('agent_runs')
      .select(`id, org_id, data_source_id, user_id, question, status${withChannel ? ', channel' : ''}`)
      .eq('id', id)
      .limit(1)
  let { data, error: runError } = await readRun(true)
  if (runError && isMissingColumnError(runError)) ({ data, error: runError } = await readRun(false))
  if (!data || data.length === 0) return Response.json({ error: 'not_found' }, { status: 404 })
  const run = data[0] as unknown as {
    id: string
    org_id: string
    data_source_id: string | null
    user_id: string | null
    question: string
    status: string
    channel?: string | null
  }
  const draftingMonitor = run.channel === 'monitor'
  if (run.user_id !== user.id) return Response.json({ error: 'forbidden' }, { status: 403 })
  if (!run.data_source_id) return Response.json({ error: 'no_data_source' }, { status: 400 })
  if (run.status !== 'queued') return Response.json({ error: 'already_started' }, { status: 409 })

  // Atomic claim BEFORE opening the stream: two concurrent GETs both passing the status
  // pre-check above would otherwise both execute the agent (double LLM cost). markRunning
  // only matches 'queued', so exactly one caller wins; the loser gets a clean 409.
  if (!(await markRunning(run.id))) {
    return Response.json({ error: 'already_started' }, { status: 409 })
  }

  // Thread continuity (?priors=id,id — the Trigger path carries this in its payload instead):
  // rebuild the same English preamble the BFF builds, bound to this run's org + data source.
  const priorsParam = new URL(req.url).searchParams.get('priors') ?? ''
  const priorRunIds = priorsParam.split(',').filter(Boolean)
  const priorTurns = await loadPriorTurns(admin, {
    orgId: run.org_id,
    dataSourceId: run.data_source_id,
    priorRunIds,
  })
  const agentQuestion = draftingMonitor ? buildMonitorDraftQuestion(run.question) : buildThreadPreamble(priorTurns, run.question)
  const monitorDraft = draftingMonitor
    ? { goal: run.question, timezone: await getOrgTimezone(admin, run.org_id) }
    : undefined

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        } catch {
          /* client disconnected */
        }
      }
      try {
        // route by the data source's engine: Firestore (document) → firestore agent, else SQL.
        const { data: dsRows } = await admin
          .from('data_sources')
          .select('engine')
          .eq('id', run.data_source_id!)
          .limit(1)
        const engine = (dsRows?.[0] as { engine?: string } | undefined)?.engine
        const runArgs = {
          orgId: run.org_id,
          dataSourceId: run.data_source_id!,
          userId: user.id,
          runId: run.id,
          question: agentQuestion,
          locale: await getLocale(),
          monitorDraft,
          emit: (c: AnalysisChunk) => send(c),
        }
        const result = await runByEngine(engine, runArgs)
        await persistRun(run.id, result)
      } catch (e) {
        send({ type: 'status', status: 'failed' })
        await persistFailedRun(run.id, e)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  })
}
