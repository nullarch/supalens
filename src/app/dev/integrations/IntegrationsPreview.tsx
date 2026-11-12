'use client'

import { useState, type MouseEvent } from 'react'
import { IntegrationsView, type SlackScopeSnapshot } from '@/app/app/settings/integrations/IntegrationsView'
import type { ConnectionRow, DataSourceRow, GithubRepoRow } from '@/app/app/settings/integrations/settings-data'

/** Same full composition as production, with local actions and inert navigation. */
export function IntegrationsPreview({ mode, role }: { mode: string; role: string }) {
  const long = mode === 'long'
  const status = ['pending', 'revoked', 'expired', 'error'].includes(mode) ? mode : mode === 'unknown' ? 'unexpected_record_value' : 'active'
  const connection = (id: string, provider: string, name: string): ConnectionRow => ({
    id, provider, display_name: long ? `${name} `.repeat(25) : name, status,
    installation_id: provider === 'github' ? 12345 : null, created_at: '2026-09-01T10:00:00Z',
  })
  const conns = mode === 'empty' ? [] : [
    connection('sample-gh', 'github', 'Northstar'), connection('sample-slack-a', 'slack', 'Business team'),
    connection('sample-slack-b', 'slack', 'Engineering team'), connection('sample-supa', 'supabase', 'Northstar projects'),
  ]
  const sources: DataSourceRow[] = mode === 'empty' ? [] : [
    { id: 'sample-db', connection_id: 'sample-supa', name: long ? 'Production database '.repeat(22) : 'Production database', engine: 'postgres', provider: 'supabase', status: mode === 'sources-disabled' ? 'disabled' : 'active' },
    { id: 'sample-db-pending', connection_id: 'sample-supa', name: 'Staging database', engine: 'postgres', provider: 'supabase', status: 'pending' },
    { id: 'sample-direct', connection_id: null, name: long ? 'Direct source '.repeat(25) : 'Operations', engine: 'mysql', provider: 'direct', status: mode === 'sources-disabled' ? 'disabled' : 'error' },
    { id: 'sample-firestore', connection_id: null, name: long ? 'Firestore project '.repeat(25) : 'Events', engine: 'firestore', provider: 'firebase', status: mode === 'sources-disabled' ? 'disabled' : 'active' },
  ]
  const [repos, setRepos] = useState<GithubRepoRow[]>(mode === 'empty' ? [] : [
    { id: 'sample-repo-a', connection_id: 'sample-gh', full_name: long ? 'northstar/' + 'sample-repository-'.repeat(15) : 'northstar/payments', default_branch: 'main', is_private: true, analysis_enabled: true, status: 'active' },
    { id: 'sample-repo-b', connection_id: 'sample-gh', full_name: 'northstar/worker', default_branch: long ? 'feature-branch-'.repeat(15) : 'main', is_private: false, analysis_enabled: false, status: 'active' },
  ])
  const [scopes, setScopes] = useState<Record<string, SlackScopeSnapshot>>({
    'sample-slack-a': { channels: [{ id: 'CA', name: long ? 'business-alerts-'.repeat(20) : 'business-alerts' }, { id: 'CB', name: 'operations' }], selected: ['CA'], unavailable: mode === 'slack-unavailable' || status !== 'active' },
    'sample-slack-b': { channels: [{ id: 'CE', name: 'engineering' }, { id: 'CF', name: 'deployments' }], selected: ['CE'], unavailable: mode === 'slack-unavailable' || status !== 'active' },
  })
  const [calls, setCalls] = useState<unknown[]>([])
  const record = (value: unknown) => setCalls(previous => [...previous, value])
  const noNavigation = (event: MouseEvent) => { if ((event.target as HTMLElement).closest('a')) event.preventDefault() }
  const reloadHref = `/dev/integrations?mode=${mode}&role=${role}`
  return <div onClickCapture={noNavigation} onAuxClickCapture={noNavigation} onContextMenuCapture={noNavigation}>
    <p style={{ margin: '0 0 20px', fontSize: 12, lineHeight: 1.7, color: 'var(--ink-3)' }}>DESIGN FIXTURE · Sample connections · Local actions only · Links disabled. No OAuth, provider requests, real analysis or account changes.</p>
    <IntegrationsView orgId="sample-org" conns={conns} sources={sources} repos={repos} canManage={['owner', 'admin'].includes(role)} canAnalyze={role !== 'viewer'}
      slackReady={mode !== 'slack-unconfigured'} slackScopes={scopes}
      actions={{
        disconnect: async data => { record({ action: 'disconnect', connectionId: data.get('connectionId') }) },
        resync: async data => { record({ action: 'resync', connectionId: data.get('connectionId') }) },
        scope: async (connectionId, ids) => {
          record({ action: 'scope', connectionId, ids }); setScopes(previous => ({ ...previous, [connectionId]: { ...previous[connectionId], selected: ids } })); return { ok: true }
        }, refresh: () => {}, reloadHref,
        repository: {
          toggleAction: async data => {
            const repoId = data.get('repoId'), enabled = data.get('enabled') === 'true'
            record({ action: 'toggle', repoId, enabled }); setRepos(previous => previous.map(repo => repo.id === repoId ? { ...repo, analysis_enabled: enabled } : repo)); return { ok: true }
          },
          analyzeAction: async input => { record({ action: 'analyze', ...input }); return { ok: false, status: 400, data: { error: 'sample-only' } } },
          renderRun: () => <p>Sample stream only</p>, refresh: () => {}, reloadHref,
        },
      }} />
    <details style={{ marginTop: 32 }}><summary>Local fixture calls</summary><output data-full-integration-calls>{JSON.stringify(calls)}</output></details>
  </div>
}
