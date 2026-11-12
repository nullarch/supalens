'use client'

import { useRef, useState } from 'react'
import McpClient from '@/app/app/settings/developer/McpClient'
import type { ApiKeySummary } from '@/lib/mcp/keys'

const exampleKey: ApiKeySummary = {
  id: 'fixture-key', prefix: 'sl_example', lastFour: 'demo', scopes: ['read'],
  createdAt: '2026-09-01T00:00:00Z', lastUsedAt: '2026-09-06T21:00:00Z', revokedAt: null,
}

/** No fetch, clipboard access, credentials or server actions in this fixture. */
export function McpPreview({ mode }: { mode: string }) {
  const initial = mode === 'empty' ? [] : [{ ...exampleKey, lastUsedAt: mode === 'long' ? 'invalid' : exampleKey.lastUsedAt }]
  const keys = useRef(initial)
  const reads = useRef(0)
  const [calls, setCalls] = useState<string[]>([])
  const request = async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    setCalls(previous => [...previous, method])
    await new Promise(resolve => setTimeout(resolve, mode === 'pending' ? 1200 : 50))
    if (method === 'GET') {
      reads.current++
      if ((mode === 'mint-refresh' || mode === 'revoke-refresh') && reads.current === 1) return Response.json({ error: 'sample' }, { status: 500 })
      return Response.json({ keys: keys.current })
    }
    if (mode === 'throw') throw new Error('Simulated network failure')
    if (mode === 'failure') return Response.json({ error: 'sample' }, { status: 403 })
    if (mode === 'malformed') return Response.json(method === 'POST' ? { token: 7 } : { revoked: false })
    if (method === 'POST') {
      keys.current = [...keys.current, { ...exampleKey, id: 'fixture-issued', prefix: 'sl_sample', lastFour: 'only' }]
      return Response.json({ token: 'SAMPLE_ONLY_NOT_A_CREDENTIAL', id: 'fixture-issued' })
    }
    keys.current = keys.current.map(key => key.id === 'fixture-key' ? { ...key, revokedAt: '2026-09-07T00:00:00Z' } : key)
    return Response.json({ revoked: true })
  }
  const copy = async () => {
    setCalls(previous => [...previous, 'COPY'])
    await new Promise(resolve => setTimeout(resolve, mode === 'pending' ? 1200 : 50))
    if (mode === 'copy-failed') throw new Error('Simulated clipboard failure')
  }
  return <>
    <McpClient initialKeys={initial} endpoint={`https://supalens.example/${mode === 'long' ? 'sample-workspace-with-a-long-identifier/'.repeat(5) : ''}api/mcp`}
      canManage={mode !== 'viewer'} request={request} copy={copy} />
    <details style={{ marginTop: 24 }}><summary>Local fixture calls (no payloads or secrets)</summary><output data-mcp-calls>{JSON.stringify(calls)}</output></details>
  </>
}
