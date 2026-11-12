'use client'

import { useMemo, useState } from 'react'
import { BaseModal, ModalButton } from '@/components/modals'
import { DirectDataSourceForm } from '@/components/data-sources/DirectDataSourceForm'
import { FirestoreDataSourceForm } from '@/components/data-sources/FirestoreDataSourceForm'
import { ProjectPickerView } from '@/app/app/setup/ProjectPickerView'
import { AttachRepoModal } from '@/app/app/sources/AttachRepoModal'
import { SourcesClient, type SourceView } from '@/app/app/sources/SourcesClient'
import type { SupabaseProjectChoice } from '@/lib/data-sources/supabase-projects'

const baseSource: SourceView = {
  id: 'fixture-list-0', name: 'Production', engine: 'postgres', provider: 'supabase', status: 'active', isOAuth: true,
  tableCount: 48, lastSyncedLabel: '12m ago', syncStatus: 'fresh', attachedRepoId: 'fixture-r1',
  attachedRepoFullName: 'northstar/analytics-web', contextStatus: 'fresh', contextFromRepo: true, isDemo: false,
  monitorCount: 6, slackChannel: 'revenue-alerts', kpiExtractionStatus: 'completed', kpiExtractionAt: null,
  kpiProposed: 0, kpiAccepted: 6, kpiStale: 0,
}

/** Every pipeline state the list can show: fresh, stale + proposals, syncing, generating, failed, sample. */
const listSources: SourceView[] = [
  baseSource,
  { ...baseSource, id: 'fixture-list-1', name: 'Billing replica', provider: 'direct', isOAuth: false, tableCount: 23, lastSyncedLabel: '2h ago',
    attachedRepoId: 'fixture-r2', attachedRepoFullName: 'northstar/analytics-worker', contextStatus: 'stale', monitorCount: 0,
    slackChannel: null, kpiProposed: 8, kpiAccepted: 0 },
  { ...baseSource, id: 'fixture-list-2', name: 'International subscription entitlement warehouse', engine: 'mysql', provider: 'direct', isOAuth: false,
    tableCount: null, lastSyncedLabel: '—', syncStatus: 'syncing', attachedRepoId: null, attachedRepoFullName: null,
    contextStatus: null, contextFromRepo: false, monitorCount: 0, slackChannel: null, kpiExtractionStatus: 'running', kpiAccepted: 0 },
  { ...baseSource, id: 'fixture-list-3', name: 'Mobile app events', engine: 'firestore', provider: 'firebase', isOAuth: false, tableCount: 12,
    lastSyncedLabel: 'yesterday', attachedRepoId: 'fixture-r3', attachedRepoFullName: 'northstar/api', contextStatus: 'generating',
    monitorCount: 0, kpiExtractionStatus: null, kpiAccepted: 0 },
  { ...baseSource, id: 'fixture-list-4', name: 'Legacy orders', status: 'error', tableCount: 31, lastSyncedLabel: '9d ago', syncStatus: 'failed',
    attachedRepoId: null, attachedRepoFullName: null, contextStatus: 'failed', contextFromRepo: false, monitorCount: 2, kpiAccepted: 2 },
]
const demoSource: SourceView = {
  ...baseSource, id: 'fixture-demo', name: 'Sample · e-commerce', provider: 'direct', isOAuth: false, tableCount: 9,
  lastSyncedLabel: '3d ago', attachedRepoId: null, attachedRepoFullName: null, contextFromRepo: false, isDemo: true,
  monitorCount: 0, slackChannel: null, kpiAccepted: 10,
}

const repos = [
  { id: 'fixture-r1', fullName: 'northstar/analytics-web', defaultBranch: 'main' },
  { id: 'fixture-r2', fullName: 'northstar/analytics-worker', defaultBranch: 'release/subscription-entitlement-processing' },
  ...['api', 'product', 'payments', 'infrastructure', 'design-system', 'marketing', 'billing-international'].map((name, index) => ({ id: `fixture-r${index + 3}`, fullName: `northstar/${name}`, defaultBranch: 'main' })),
]

function sampleProjects(mode: string): SupabaseProjectChoice[] {
  if (mode === 'empty' || mode === 'reconnect') return []
  return ['none', 'none', 'active', mode === 'pending' ? 'pending' : 'error', 'disabled'].map((state, i) => ({
    ref: `fixture-project-${i}`, name: ['Northstar production', 'Northstar staging', 'Analytics reporting', 'International subscription entitlement processing', 'Archived development'][i],
    region: 'us-west-1', status: state === 'disabled' ? 'INACTIVE' : 'ACTIVE_HEALTHY', bootstrappable: state !== 'disabled',
    env: i === 0 ? 'production' : i === 1 ? 'staging' : 'unknown', state: state as SupabaseProjectChoice['state'],
    dataSourceId: state === 'active' ? 'fixture-source' : null, errorCode: state === 'error' ? 'generic' : null,
    stages: { authorized: true, roleCreated: state === 'active', schemaScanned: state === 'active' },
  }))
}

export function ConnectionsPreview({ view, mode }: { view: string; mode: string }) {
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(new Set(['fixture-project-0']))
  const [submitting, setSubmitting] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const source = useMemo(() => ({ id: 'fixture-source', name: 'analytics', attachedRepoId: mode === 'attached' ? 'fixture-r1' : null }), [mode])

  if (view === 'list') return <SourcesClient sources={mode === 'real' ? listSources : [...listSources, demoSource]} repos={repos} githubAppUrl={null} />
  if (view === 'connect') return <SourcesClient sources={mode === 'demo' ? [demoSource] : []} repos={[]} githubAppUrl={null} />
  if (view === 'projects') return <ProjectPickerView projects={sampleProjects(mode)} canProvision={mode !== 'viewer'} needsReconnect={mode === 'reconnect'}
    selected={selected} submitting={submitting} error={error}
    onToggle={ref => setSelected(prev => { const next = new Set(prev); if (next.has(ref)) next.delete(ref); else next.add(ref); return next })}
    onProvision={refs => {
      setSubmitting(new Set(refs))
      setError(null)
      setTimeout(() => { setSubmitting(new Set()); setError('Sample provisioning failed. No connection request was sent.') }, 600)
    }} />
  return <>
    <ModalButton onClick={() => setOpen(true)}>Open preview</ModalButton>
    {view === 'repo' ? <AttachRepoModal source={open ? source : null} repos={mode === 'empty' ? [] : repos} githubAppUrl={null}
      onClose={() => setOpen(false)} onSaved={() => setOpen(false)} /> :
      <BaseModal open={open} onClose={() => { if (!busy) setOpen(false) }} title={mode === 'firestore' ? 'Firestore' : mode === 'mysql' ? 'MySQL' : 'PostgreSQL'} size="lg" className="max-w-[600px]">
        {mode === 'firestore' ? <FirestoreDataSourceForm onDone={() => setOpen(false)} onBusyChange={setBusy} /> :
          <DirectDataSourceForm engine={mode === 'mysql' ? 'mysql' : 'postgres'} onDone={() => setOpen(false)} onBusyChange={setBusy} />}
      </BaseModal>}
  </>
}
