import { notFound } from 'next/navigation'

import { state, type LocalRun } from '@/lib/tasks/builtin/state'
import { isBuiltinTaskBackend } from '@/lib/tasks/backend'
import { createClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Any member of the run's org may watch it (the same rule as reading the run row). */
async function mayRead(run: LocalRun): Promise<boolean> {
  const supabase = await createClient()
  if (!supabase) return false
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  if (run.userId && run.userId === user.id) return true
  if (!run.orgId) return false
  const { data } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('org_id', run.orgId)
    .eq('user_id', user.id)
    .limit(1)
  return Boolean(data && data.length > 0)
}

/**
 * Server-sent events for one run of the BUILT-IN task backend: every chunk of every stream the
 * task published (replayed from the start, then live) and each status change. The browser side
 * is src/lib/tasks/builtin/react-hooks.ts. On a Trigger.dev build this route does not exist.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isBuiltinTaskBackend()) notFound()
  const { id } = await params
  const run = state().runs.get(id)
  // unknown and unauthorised look the same, so run ids cannot be probed
  if (!run || !(await mayRead(run))) return Response.json({ error: 'not_found' }, { status: 404 })

  const encoder = new TextEncoder()
  const sent = new Map<string, number>()
  let lastStatus: string | null = null
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))

      const finish = () => {
        if (closed) return
        closed = true
        run.listeners.delete(flush)
        clearInterval(heartbeat)
        try {
          controller.close()
        } catch {
          /* already closed by the client */
        }
      }

      const flush = () => {
        if (closed) return
        try {
          for (const [name, buffer] of run.streams) {
            const from = sent.get(name) ?? 0
            for (let i = from; i < buffer.chunks.length; i++) write('chunk', { name, chunk: buffer.chunks[i] })
            sent.set(name, buffer.chunks.length)
          }
          if (run.status !== lastStatus) {
            lastStatus = run.status
            write('status', { status: run.status })
          }
          if (run.endedAt) finish()
        } catch {
          finish()
        }
      }

      // comment frames keep proxies from closing an idle connection during a long agent turn
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'))
        } catch {
          finish()
        }
      }, 20_000)

      run.listeners.add(flush)
      req.signal.addEventListener('abort', finish)
      flush()
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
