'use client'

import { useEffect, useRef, useState } from 'react'

import { AgentView, type AgentChunk, type AgentPhase } from './AgentView'

/** Local-dev streamer: consumes the inline SSE run endpoint (no Trigger.dev). Reports
 *  completion via onDone so the parent transcript can swap the Stop action for Share. */
export function AgentStreamLocal({
  runId,
  dataSourceId,
  priorRunIds,
  question,
  onDone,
}: {
  runId: string
  dataSourceId?: string | null
  /** the turn's question — names the draft in AgentView's "turn into monitor" link */
  question?: string
  /** thread continuity: prior run ids of this conversation (the SSE route rebuilds the preamble). */
  priorRunIds?: string[]
  onDone?: (phase: AgentPhase) => void
}) {
  const [chunks, setChunks] = useState<AgentChunk[]>([])
  const [phase, setPhase] = useState<AgentPhase>('streaming')
  // capture once — the priors of a turn are fixed at submit; a re-render must not resubscribe
  const priorsRef = useRef(priorRunIds ?? [])

  useEffect(() => {
    const priors = priorsRef.current
    const qs = priors.length ? `?priors=${priors.map(encodeURIComponent).join(',')}` : ''
    const es = new EventSource(`/api/agent/runs/${runId}/stream${qs}`)

    es.onmessage = (e) => {
      let c: AgentChunk
      try {
        c = JSON.parse(e.data) as AgentChunk
      } catch {
        return
      }
      setChunks((prev) => [...prev, c])
      if (c.type === 'status') {
        if (c.status === 'done') {
          setPhase('done')
          es.close()
        } else if (c.status === 'failed' || c.status === 'budget_exceeded') {
          setPhase('error')
          es.close()
        }
      }
    }

    es.onerror = () => {
      es.close()
      setPhase((p) => (p === 'done' ? p : 'error'))
    }

    return () => es.close()
  }, [runId])

  // fire onDone at most once (onDone is a fresh closure each render, so guard against re-firing)
  const fired = useRef(false)
  useEffect(() => {
    if (phase !== 'streaming' && !fired.current) {
      fired.current = true
      onDone?.(phase)
    }
  }, [phase, onDone])

  return <AgentView chunks={chunks} phase={phase} dataSourceId={dataSourceId} question={question} />
}
