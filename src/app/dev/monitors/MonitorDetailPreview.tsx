'use client'

import { useEffect, useRef, useState } from 'react'
import { MonitorDetailActions, type MonitorDetailIO } from '@/app/app/monitors/[id]/MonitorDetailActions'
import { PageHead } from '@/components/dashboard/PageHead'

/** Every callback is local. This fixture never queries a database or invokes a server action. */
export function MonitorDetailPreview({ outcome, viewer }: { outcome: string; viewer: boolean }) {
  // Mount the controls only after hydration: a click on the server-rendered markup would be lost.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const [id, setId] = useState('fixture-monitor-a')
  const [calls, setCalls] = useState<string[]>([])
  const [refreshes, setRefreshes] = useState(0)
  const [navigation, setNavigation] = useState('')
  const release = useRef<(() => void) | null>(null)
  const attempt = useRef(0)
  async function reply(action: string, target: string, enabled?: boolean) {
    const number = ++attempt.current
    setCalls(prev => [...prev, JSON.stringify({ action, target, enabled })])
    if (outcome === 'pending') await new Promise<void>(resolve => { release.current = resolve })
    else await new Promise(resolve => setTimeout(resolve, 250))
    if (outcome === 'throw') throw new Error('Local transport simulation')
    if (outcome === 'malformed') return { ok: 'true' }
    if (outcome === 'failure' || (outcome === 'retry' && number === 1)) return { ok: false, message: 'Private fixture driver message' }
    if (action === 'test') return { ok: true, data: { value: 3, met: outcome !== 'unmet', detail: 'Sample value 3; no production query was run' } }
    return { ok: true }
  }
  const io: MonitorDetailIO = {
    toggle: (target, enabled) => reply('toggle', target, enabled),
    remove: target => reply('delete', target),
    test: target => reply('test', target),
    refresh: () => { setRefreshes(count => count + 1); if (outcome === 'refresh-error') throw new Error('Local refresh simulation') },
    navigate: href => { setNavigation(href); if (outcome === 'navigation-error') throw new Error('Local navigation simulation') },
  }
  const name = 'Paid without access / グローバルプロダクト / 결제 완료 후 접근 권한 누락 / workspace_identifier_without_spaces_012345678901234567890123456789'
  return <main style={{ maxWidth: 1168, padding: '32px 20px', margin: '0 auto' }}>
    <p style={{ fontSize: 12, color: 'var(--ink-2)' }}>LOCAL DESIGN FIXTURE · Sample data · All action and navigation callbacks are local.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
      <button className="dx-btn-ghost" type="button" data-fixture-switch onClick={() => setId('fixture-monitor-b')}>Switch sample monitor</button>
      <button className="dx-btn-ghost" type="button" data-fixture-release onClick={() => release.current?.()}>Release pending reply</button>
    </div>
    <output data-fixture-calls style={{ display: 'block', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify({ calls, refreshes, navigation, id })}</output>
    <section style={{ marginTop: 24 }}>
      <PageHead title="Paid without access" subtitle="Northstar / sample workspace" actions={ready ? <MonitorDetailActions id={id} name={name} enabled canManage={!viewer} askHref="/app/ask?q=fixture-only" io={io} /> : undefined} />
      <div className="dx-card" style={{ padding: 24, marginTop: 24 }}><p>Sample monitor definition</p><p style={{ color: 'var(--ink-2)' }}>The controls above are the actual detail-page component. This sample does not show live monitoring data.</p></div>
    </section>
  </main>
}
