'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ShareAction, StopAction, type RunActionIO } from '@/components/agent/RunActions'

export function RunActionPreview({ mode }: { mode: string }) {
  const [calls, setCalls] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const [runId, setRunId] = useState('sample-run')
  const recovered = useRef(false)
  const actions = useMemo<RunActionIO>(() => {
    async function call(name: string) {
      setCalls(previous => [...previous, name])
      await new Promise(resolve => setTimeout(resolve, mode === 'slow' ? 1800 : 600))
      if (mode === 'throw' && !recovered.current) throw new Error('Sample transport failure')
    }
    return {
      share: async id => {
        await call(`share:${id}`)
        if (!recovered.current) {
          if (mode === 'share-malformed') return {} as Awaited<ReturnType<RunActionIO['share']>>
          if (mode === 'share-truthy') return { ok: 'true', url: 'https://example.invalid/share/sample' } as unknown as Awaited<ReturnType<RunActionIO['share']>>
          if (mode === 'share-url') return { ok: true, url: 'https://private:sample@example.invalid/account?secret=sample' }
          if (mode === 'failure') return { ok: false, error: 'Private sample permission failure' }
        }
        return { ok: true, url: `https://example.invalid/share/${'sample-'.repeat(18)}${id}` }
      },
      revoke: async id => {
        await call(`revoke:${id}`)
        if (!recovered.current && mode === 'revoke-throw') throw new Error('Sample revoke failure')
        if (!recovered.current && mode === 'revoke-malformed') return {} as Awaited<ReturnType<RunActionIO['revoke']>>
        if (!recovered.current && mode === 'revoke-truthy') return { ok: 1 } as unknown as Awaited<ReturnType<RunActionIO['revoke']>>
        return { ok: recovered.current || !['failure', 'revoke-failure'].includes(mode) }
      },
      copy: async () => { await call('copy'); if (mode === 'copy-failure' && !recovered.current) throw new Error('Sample clipboard denied') },
      cancel: async id => {
        await call(`cancel:${id}`)
        if (mode === 'failure' && !recovered.current) return Response.json({ error: 'unauthorized' }, { status: 401 })
        if (mode === 'stop-json') return new Response('not JSON', { status: 200 })
        return Response.json(mode === 'malformed' ? {} : { ok: true, status: mode === 'terminal' ? 'succeeded' : mode === 'stop-status' ? 'running' : 'cancelled' }, { status: mode === 'stop-http' ? 503 : 200 })
      },
      track: name => { setCalls(previous => [...previous, `track:${name}`]); if (mode === 'track-throw') throw new Error('Local telemetry failed') },
    }
  }, [mode])
  return <div data-run-actions-ready={ready} style={{ display: 'grid', gap: 24, maxWidth: 768, margin: '0 auto' }}>
    <h1>Sample analysis actions</h1>
    <div><ShareAction runId={runId} actions={actions} /></div>
    <StopAction runId={runId} actions={actions} />
    <aside style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
      <button className="dx-btn-ghost" onClick={() => { recovered.current = true }}>Restore sample actions</button>
      <button className="dx-btn-ghost" onClick={() => setRunId('sample-other')}>Switch sample run</button>
      <pre data-action-calls style={{ whiteSpace: 'pre-wrap', font: 'inherit' }}>{calls.join('\n') || 'No calls'}</pre>
    </aside>
  </div>
}
