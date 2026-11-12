'use client'

import { useRef, useState } from 'react'
import { OnboardingWizard, type WizardProps } from '@/components/onboarding/OnboardingWizard'
import { wizardDismissKey } from '@/lib/onboarding/logic'
import { SlackStep, type SlackStepActions } from '@/app/app/setup/SlackStep'

export function WizardPreview({ outcome = 'success', ...props }: WizardProps & { outcome?: string }) {
  const [instance, setInstance] = useState(0)
  const [source, setSource] = useState(props.realSources)
  const [calls, setCalls] = useState<string[]>([])
  const [completions, setCompletions] = useState(0)
  const [refreshes, setRefreshes] = useState(0)
  const [navigation, setNavigation] = useState('')
  const release = useRef<(() => void) | null>(null)
  const attempts = useRef(0)
  const io: NonNullable<WizardProps['io']> = {
    extract: async id => {
      const attempt = ++attempts.current
      setCalls(prev => [...prev, id])
      if (outcome === 'pending') await new Promise<void>(resolve => { release.current = resolve })
      else await new Promise(resolve => setTimeout(resolve, 250))
      if (outcome === 'throw') throw new Error('Local transport simulation')
      if (outcome === 'malformed') return { status: 200, body: { ok: true } }
      if (outcome === 'running') return { status: 409, body: { error: 'extraction_in_progress' } }
      if (outcome === 'quota') return { status: 402, body: { error: 'quota_exceeded' } }
      if (outcome === 'conflict') return { status: 409, body: { error: 'repo_invalid' } }
      if (outcome === 'unavailable') return { status: 503, body: { error: 'trigger_required' } }
      if (outcome === 'unknown-server') return { status: 502, body: {} }
      if (outcome === 'rejected' || (outcome === 'retry' && attempt === 1)) return { status: 403, body: { error: 'Private fixture driver detail' } }
      return { status: 200, body: { ok: true, extractionId: 'fixture-extraction', tier: 1 } }
    },
    complete: () => { setCompletions(value => value + 1); if (outcome === 'complete-throw') throw new Error('Local completion failure') },
    refresh: () => setRefreshes(value => value + 1),
    navigate: setNavigation,
  }
  return <main style={{ padding: 24, minHeight: '150dvh' }}>
    <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7, marginBottom: 20 }}>
      DESIGN FIXTURE · Extraction, completion and navigation use local callbacks. Do not submit connection forms; browser tests intercept their API and OAuth requests.
    </p>
    <button type="button" className="dx-btn" onClick={() => {
      localStorage.removeItem(wizardDismissKey('design-fixture'))
      setInstance(value => value + 1)
    }}>Open wizard preview</button>
    <button type="button" className="dx-btn-ghost" data-fixture-release onClick={() => release.current?.()}>Release sample reply</button>
    <button type="button" className="dx-btn-ghost" data-fixture-switch onClick={() => setSource([{ id: 'fixture-source-b', name: 'Replacement sample source' }])}>Switch sample source</button>
    <output data-fixture-state style={{ display: 'block', fontSize: 12, overflowWrap: 'anywhere' }}>{JSON.stringify({ calls, completions, refreshes, navigation })}</output>
    <OnboardingWizard key={instance} {...props} realSources={source} io={io} userId="design-fixture" />
  </main>
}

/** All writes here resolve from an explicit local control, never from a server action. */
export function SlackPreview({ mode }: { mode: string }) {
  const resolveRef = useRef<(() => void) | null>(null)
  const [refreshes, setRefreshes] = useState(0)
  const [selected, setSelected] = useState<string | null>(mode === 'unselected' ? null : 'fixture-general')
  const [calls, setCalls] = useState<string[]>([])

  function waitForFixture() {
    return new Promise<void>(resolve => {
      resolveRef.current = resolve
    })
  }
  const actions: SlackStepActions = {
    saveChannel: async (id) => {
      setCalls(items => [...items, `save:${id}`])
      await waitForFixture()
      if (mode === 'throws') throw new Error('Local simulated network failure')
      if (mode === 'failed' || mode === 'rejected') return { ok: false, reason: 'error' }
      setSelected(id)
      return { ok: true, data: undefined }
    },
    sendTest: async () => {
      setCalls(items => [...items, `test:${selected ?? 'none'}`])
      await waitForFixture()
      if (mode === 'throws') throw new Error('Local simulated network failure')
      if (mode === 'rejected') return { ok: false, reason: 'error' }
      return { ok: true, data: { channels: mode === 'success' || mode === 'partial', email: mode === 'success' || mode === 'email-only' } }
    },
    refresh: () => setRefreshes(value => value + 1),
  }
  return <main style={{ maxWidth: 720, padding: '32px 20px', margin: '0 auto' }}>
    <aside style={{ borderBottom: '1px solid var(--line)', paddingBottom: 20, marginBottom: 24 }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7, marginBottom: 12 }}>
        DESIGN FIXTURE · All channel saves and test sends are local simulations. No message, server action or database write is performed.
      </p>
      <button type="button" className="dx-btn-ghost" onClick={() => {
        resolveRef.current?.()
        resolveRef.current = null
      }}>Resolve sample request</button>
      <p data-fixture-refresh={refreshes} data-fixture-calls={calls.join(',')} style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12 }}>
        Sample response: {mode} · Local refreshes: {refreshes}
      </p>
    </aside>
    <SlackStep standalone actions={actions}
      slackAppConfigured={mode !== 'unconfigured'} slackConnected={mode !== 'disconnected'}
      canConfigure={mode !== 'viewer'} selectedChannel={selected}
      channels={mode === 'empty' ? [] : [
        { id: 'fixture-general', name: 'general' },
        { id: 'fixture-alerts', name: 'alerts' },
        { id: 'fixture-international', name: 'international-subscription-entitlement-processing-and-investigations' },
      ]} />
  </main>
}
