'use client'

import { useEffect, useRef } from 'react'
import { useRealtimeRunWithStreams } from '@trigger.dev/react-hooks'

import { AgentView, type AgentChunk, type AgentPhase } from './AgentView'

// Every TERMINAL RunStatus in @trigger.dev/core must map to a terminal phase — otherwise a crashed/
// expired run stays 'streaming' forever (thinking dots + Stop button never resolve, onDone never
// fires). COMPLETED is the only success; the rest are failures.
const TERMINAL: Record<string, AgentPhase> = {
  COMPLETED: 'done',
  FAILED: 'error',
  CANCELED: 'error',
  TIMED_OUT: 'error',
  CRASHED: 'error',
  SYSTEM_FAILURE: 'error',
  EXPIRED: 'error',
}

/** Trigger.dev (production) streamer: subscribes to the run's Realtime stream with a
 *  run-scoped public token (does not relay through Vercel). Reports completion via onDone
 *  so the parent transcript can swap the Stop action for Share. */
export function AgentStream({
  runId,
  accessToken,
  dataSourceId,
  question,
  onDone,
}: {
  runId: string
  accessToken: string
  dataSourceId?: string | null
  /** the turn's question — names the draft in AgentView's "turn into monitor" link */
  question?: string
  onDone?: (phase: AgentPhase) => void
}) {
  const { run, streams, error } = useRealtimeRunWithStreams(runId, { accessToken, baseURL: process.env.NEXT_PUBLIC_TRIGGER_API_URL || undefined })
  const chunks = ((streams as Record<string, unknown[]> | undefined)?.agent ?? []) as AgentChunk[]
  const raw = (run as { status?: string } | undefined)?.status
  const phase: AgentPhase = error ? 'error' : raw ? TERMINAL[raw] ?? 'streaming' : 'streaming'

  // fire onDone at most once (onDone is a fresh closure each render, so guard against re-firing)
  const fired = useRef(false)
  useEffect(() => {
    if (phase !== 'streaming' && !fired.current) {
      fired.current = true
      onDone?.(phase)
    }
  }, [phase, onDone])

  return (
    <AgentView
      chunks={chunks}
      phase={phase}
      error={error ? String(error) : undefined}
      dataSourceId={dataSourceId}
      question={question}
    />
  )
}
