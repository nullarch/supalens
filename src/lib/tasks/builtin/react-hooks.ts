'use client'

// Built-in task backend, browser side: a drop-in for `useRealtimeRunWithStreams` from
// `@trigger.dev/react-hooks` (aliased to this file in a self-hosted build). It tails the run over
// server-sent events from this app instead of Trigger.dev's realtime API, and returns the same
// `{ run, streams, error }` shape the components already consume.
import { useEffect, useState } from 'react'

interface Options {
  accessToken?: string
  baseURL?: string
  enabled?: boolean
}

interface State {
  run: { id: string; status: string } | undefined
  streams: Record<string, unknown[]>
  error: Error | undefined
}

export function useRealtimeRunWithStreams(runId: string | undefined, options?: Options): State {
  const [state, setState] = useState<State>({ run: undefined, streams: {}, error: undefined })
  const enabled = options?.enabled !== false

  useEffect(() => {
    if (!runId || !enabled) return
    setState({ run: undefined, streams: {}, error: undefined })
    const source = new EventSource(`/api/tasks/runs/${encodeURIComponent(runId)}/events`)
    let finished = false

    source.addEventListener('status', (event) => {
      const { status } = JSON.parse((event as MessageEvent).data) as { status: string }
      if (['COMPLETED', 'FAILED', 'CANCELED'].includes(status)) {
        finished = true
        source.close()
      }
      setState((prev) => ({ ...prev, run: { id: runId, status } }))
    })
    source.addEventListener('chunk', (event) => {
      const { name, chunk } = JSON.parse((event as MessageEvent).data) as { name: string; chunk: unknown }
      setState((prev) => ({ ...prev, streams: { ...prev.streams, [name]: [...(prev.streams[name] ?? []), chunk] } }))
    })
    source.onerror = () => {
      if (finished) return
      // EventSource retries by itself while the server is reachable; a CLOSED source means it
      // gave up (the run is unknown to this server, or the session ended).
      if (source.readyState === EventSource.CLOSED) {
        setState((prev) => ({ ...prev, error: new Error('The run is no longer available.') }))
      }
    }
    return () => {
      finished = true
      source.close()
    }
  }, [runId, enabled])

  return state
}

/** Same hook without streams, for callers that only watch status. */
export function useRealtimeRun(runId: string | undefined, options?: Options) {
  const { run, error } = useRealtimeRunWithStreams(runId, options)
  return { run, error }
}
