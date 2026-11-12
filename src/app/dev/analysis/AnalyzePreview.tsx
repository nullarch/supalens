'use client'

import { useMemo, useRef, useState } from 'react'
import { AnalyzeClient, type AnalyzeIO } from '@/components/agent/AnalyzeClient'
import { AgentView } from '@/components/agent/AgentView'

function LocalStream({ run, question, onDone }: Parameters<AnalyzeIO['renderStream']>[0]) {
  const [done, setDone] = useState(false)
  return <div data-local-stream data-source={run.dataSourceId} data-mode={run.mode}>
    <AgentView readOnly phase={done ? 'done' : 'streaming'} chunks={done ? [{ type: 'text', text: `Sample answer: ${question}` }] : []} />
    {!done && <button className="dx-btn-ghost" onClick={() => { setDone(true); onDone() }}>Complete sample run</button>}
  </div>
}

export function AnalyzePreview({ mode, log = true, children }: { mode: string; log?: boolean; children?: React.ReactNode }) {
  const [calls, setCalls] = useState<string[]>([])
  const recovered = useRef(false)
  const actions = useMemo<AnalyzeIO>(() => {
    let runCount = 0
    async function delay(ms: number, signal?: AbortSignal | null) {
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
        const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
        signal?.addEventListener('abort', abort, { once: true })
      })
    }
    const log = (text: string) => setCalls(previous => [...previous, text])
    return {
      request: async (input, init) => {
        const path = new URL(String(input), 'https://example.invalid').pathname
        const method = init?.method ?? 'GET'
        const payload = init?.body ? JSON.parse(String(init.body)) : null
        log(JSON.stringify({ path, method, payload }))
        if (path.endsWith('/kpis')) return Response.json({ kpis: [{ key: 'paid', title: 'Paid without access', status: 'accepted', importance: 1 }] })
        if (path === '/api/agent/analyze') {
          const number = ++runCount
          // Slow mode deliberately delivers a late response even after abort, exercising
          // the controller's stale-response guard independently of transport cancellation.
          await delay(mode === 'slow' ? 2200 : 600, mode === 'slow' ? undefined : init?.signal)
          if (!recovered.current) {
            if (mode === 'throw') throw new Error('Sample response lost')
            if (mode === 'failure') return Response.json({ error: 'forbidden' }, { status: 403 })
            if (mode === 'quota') return Response.json({ error: 'quota_exceeded' }, { status: 402 })
            if (mode === 'malformed') return Response.json({ mode: 'trigger', runId: 'sample-incomplete' })
          }
          return Response.json(mode === 'trigger' ? { mode: 'trigger', runId: `sample-${number}`, triggerRunId: `sample-trigger-${number}`, publicToken: 'sample-not-a-token' } : { mode: 'local', runId: `sample-${number}` })
        }
        await delay(mode === 'gate-race' && path.includes('sample-a') ? 2200 : 600, init?.signal)
        if (method === 'POST') {
          if (!recovered.current && ['gate-limit', 'gate-quota'].includes(mode)) return Response.json({ error: mode === 'gate-limit' ? 'context_limit' : 'quota_exceeded' }, { status: 402 })
          if (!recovered.current && mode === 'gate-failure') return Response.json({ error: 'repo_invalid' }, { status: 409 })
          if (mode === 'gate-conflict') return Response.json({ error: 'generation_in_progress' }, { status: 409 })
          if (['gate-poll', 'gate-read-error'].includes(mode)) return Response.json({ tier: 2 })
          return Response.json({ tier: 1 })
        }
        return Response.json({ context: { status: 'fresh' } }, { status: mode === 'gate-read-error' && !recovered.current ? 503 : 200 })
      },
      refresh: () => log('refresh'),
      track: event => log(`track:${event}`),
      runActions: {
        share: async id => { log(`share:${id}`); await delay(600); return { ok: true, url: `https://example.invalid/share/${id}` } },
        revoke: async id => { log(`revoke:${id}`); await delay(600); return { ok: true } },
        copy: async () => { log('copy'); await delay(600) },
        cancel: async id => { log(`cancel:${id}`); await delay(600); return Response.json({ ok: true, status: 'cancelled' }) },
        track: event => log(`track:${event}`),
      },
      renderStream: props => <LocalStream key={props.run.mode === 'local' ? props.run.runId : props.run.triggerRunId} {...props} />,
    }
  }, [mode])
  const gate = mode.startsWith('gate-')
  const sources = useMemo(() => [
    { id: 'sample-a', name: 'Northstar / production', isDemo: mode === 'demo', hasRepo: mode !== 'gate-schema', context: gate ? undefined : 'code' as const },
    { id: 'sample-b', name: 'Harbor / staging', hasRepo: true, context: gate ? undefined : 'schema' as const },
  ], [mode, gate])
  return <>
    <AnalyzeClient dataSources={sources} actions={actions}>{children}</AnalyzeClient>
    {log && <aside style={{ marginTop: 24, fontSize: 12, overflowWrap: 'anywhere' }}>
      <button className="dx-btn-ghost" onClick={() => { recovered.current = true }}>Restore sample responses</button>
      <pre data-ask-calls style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{calls.join('\n') || 'No calls'}</pre>
    </aside>}
  </>
}
