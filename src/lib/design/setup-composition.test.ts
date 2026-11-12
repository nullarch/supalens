import { describe, expect, it, vi } from 'vitest'
import { computeActivation } from '@/lib/activation/logic'
import { common, localClient, oneElement } from './composition-fixture.test-helper'
import { loadRoute } from './route-harness.test-helper'

describe('actual setup/source/KPI assembly with explicit local IO', () => {
  for (const manager of [true, false]) for (const justConnected of [true, false]) {
    it(`setup preserves persisted progress and role-gated notification props (${manager}/${justConnected})`, async () => {
      const { client } = localClient({
        data_sources: [{ id: 'demo', is_demo: true }, { id: 'real', name: 'Production', repo_id: 'repo-a', is_demo: false }],
        github_repositories: [{ id: 'repo-a', full_name: 'sample/app' }], organizations: [{ plan: 'basic' }],
      })
      const state = computeActivation({ realActiveSources: 1, reposAttached: 1, contextsGenerated: 0, kpisProposed: 0, kpisAccepted: 2, monitorsEnabled: 1, slackConnected: false, alertChannelConfigured: false })
      const scan = { active: true, resumeFrom: 'schema', sample: 'persisted progress' }
      const getScan = vi.fn(async () => scan), projects = [{ id: 'project-a', bootstrappable: true, state: 'available' }]
      const listProjects = vi.fn(async () => ({ projects, needsReconnect: true }))
      const notif = { slackConnected: true, slackChannels: [{ id: 'channel-a', name: 'signals' }], selectedSlackChannel: 'channel-a', token: 'never-cross-view' }
      const readNotif = vi.fn(async () => notif)
      const page = loadRoute('app/setup/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/utils/supabase/admin': { createAdminClient: () => null },
        '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' },
        '@/lib/org/require-role': { userHasOrgRole: async () => manager },
        '@/lib/activation/state': { getActivationState: async () => state },
        '@/lib/alerts/evaluate': { effectiveCheckInterval: (value: number) => value }, '@/lib/plans/limits': { getPlanLimit: () => 600 },
        '@/lib/data-sources/supabase-projects': { listConnectionProjects: listProjects },
        '@/lib/bootstrap/status': { getBootstrapStatus: getScan }, '@/lib/alerts/server': { loadNotificationConfig: readNotif },
        '@/lib/slack-app/config': { slackConfigured: () => true }, './SetupClient': { SetupClient: 'SetupClient' },
      })
      const view = oneElement(await page.default({ searchParams: Promise.resolve(justConnected ? { select: 'supabase' } : {}) }), 'SetupClient')
      expect(view.props).toMatchObject({ orgId: 'org-a', steps: state.steps, nextStep: state.nextStep, completed: false,
        firstSourceId: 'real', firstSourceName: 'Production', repoName: 'sample/app', hasRepo: true,
        kpisAccepted: 2, monitorsEnabled: 1, intervalSec: 600, canConfigure: manager,
        showPicker: justConnected, needsReconnect: justConnected,
        projects: justConnected ? projects : [], slackConnected: manager,
        slackChannels: manager ? notif.slackChannels : [], selectedSlackChannel: manager ? 'channel-a' : null,
      })
      expect(view.props.scanStatus).toBe(scan)
      expect(getScan).toHaveBeenCalledExactlyOnceWith('real')
      expect(listProjects).toHaveBeenCalledTimes(justConnected ? 1 : 0)
      expect(readNotif).toHaveBeenCalledTimes(manager ? 1 : 0)
      expect(JSON.stringify(view.props)).not.toContain('never-cross-view')
    })
  }
  for (const role of ['owner', 'viewer']) {
    it(`KPI page passes unchanged catalog/extraction and source-org role (${role})`, async () => {
      const { client, calls } = localClient({ data_sources: [{ id: 'source-a', name: 'Production', engine: 'postgres', org_id: 'source-org' }], organization_members: [{ role }] })
      const kpis = [{ id: 'kpi-a', status: 'proposed' }], extraction = { status: 'failed' }, dashboards = [{ id: 'report-a' }]
      const list = vi.fn(async () => kpis), latest = vi.fn(async () => extraction)
      const page = loadRoute('app/sources/[id]/kpis/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/kpi/service': { listKpis: list, latestExtraction: latest },
        '@/lib/dashboards/actions': { listDashboardsForPicker: async () => dashboards },
        './KpiReviewClient': { KpiReviewClient: 'KpiReviewClient' },
      })
      const view = oneElement(await page.default({ params: Promise.resolve({ id: 'source-a' }) }), 'KpiReviewClient')
      expect(view.props).toEqual({ sourceId: 'source-a', sourceName: 'Production', initialKpis: kpis, initialExtraction: extraction, dashboards, canManage: role === 'owner' })
      expect(list).toHaveBeenCalledExactlyOnceWith('source-a')
      expect(latest).toHaveBeenCalledExactlyOnceWith('source-a')
      expect(calls).toContainEqual(['organization_members', 'eq', 'org_id', 'source-org'])
      expect(calls).toContainEqual(['data_sources', 'is', 'deleted_at', null])
    })
  }
  for (const sources of [[], [{ id: 'source-a', engine: 'firestore' }]]) {
    it(`KPI page stops before privileged catalog reads for missing/unsupported source (${sources.length})`, async () => {
      const { client } = localClient({ data_sources: sources })
      const read = vi.fn(async () => [])
      const page = loadRoute('app/sources/[id]/kpis/page.tsx', {
        ...common, '@/utils/supabase/server': { createClient: async () => client },
        '@/lib/kpi/service': { listKpis: read, latestExtraction: read },
        '@/lib/dashboards/actions': { listDashboardsForPicker: read }, './KpiReviewClient': { KpiReviewClient: 'KpiReviewClient' },
      })
      await expect(page.default({ params: Promise.resolve({ id: 'source-a' }) })).rejects.toThrow('NOT_FOUND')
      expect(read).not.toHaveBeenCalled()
    })
  }
  it('sources keep per-source monitor/context/KPI state and per-org channel names separate', async () => {
    const { client } = localClient({
      data_sources: [
        { id: 'sql-a', org_id: 'org-a', connection_id: 'connection-a', name: 'SQL', engine: 'postgres', provider: 'supabase', status: 'active', repo_id: 'repo-a', is_demo: false },
        { id: 'fire-b', org_id: 'org-b', connection_id: null, name: 'Firestore', engine: 'firestore', provider: 'direct', status: 'active', repo_id: null, is_demo: false },
      ],
      data_source_schemas: [{ data_source_id: 'sql-a', object_count: 8, synced_at: null, status: 'ready', content_hash: 'new-hash' }],
      data_source_context: [{ data_source_id: 'sql-a', status: 'fresh', source_repo_id: 'repo-a', schema_hash: 'old-hash' }],
      github_repositories: [{ id: 'repo-a', full_name: 'sample/app', default_branch: null }],
      alerts: [{ data_source_id: 'sql-a' }, { data_source_id: 'sql-a' }, { data_source_id: 'fire-b' }],
    })
    const admin = localClient({ notification_channels: [{ org_id: 'org-a', label: 'signals-a', target: 'C-A' }, { org_id: 'org-b', label: 'signals-b', target: 'C-B' }] })
    const counts = vi.fn(async () => ({ proposed: 3, accepted: 2, stale: 1 })), latest = vi.fn(async () => ({ status: 'failed', createdAt: '2026-09-08T00:00:00Z' }))
    const page = loadRoute('app/sources/page.tsx', {
      ...common, '@/utils/supabase/server': { createClient: async () => client },
      // The page reads the ACTIVE workspace and scopes every query to it (RLS alone would admit
      // every org the caller belongs to).
      '@/lib/org/server': { ensurePrimaryOrg: async () => 'org-a' },
      '@/utils/supabase/admin': { createAdminClient: () => admin.client },
      '@/lib/github-app/config': { githubAppSlug: () => 'sample-app', appPublicUrl: () => 'https://github.com/apps/sample-app' },
      '@/lib/kpi/service': { countKpisByStatus: counts, latestExtraction: latest },
      '@/components/dashboard/PageHead': { PageHead: 'PageHead' }, './SourcesClient': { SourcesClient: 'SourcesClient' },
    })
    const view = oneElement(await page.default(), 'SourcesClient')
    expect(view.props.sources).toEqual([
      expect.objectContaining({ id: 'sql-a', monitorCount: 2, contextStatus: 'stale', tableCount: 8, attachedRepoFullName: 'sample/app', slackChannel: 'signals-a', kpiProposed: 3, kpiAccepted: 2, kpiStale: 1, kpiExtractionStatus: 'failed', isOAuth: true }),
      expect.objectContaining({ id: 'fire-b', monitorCount: 1, contextStatus: null, slackChannel: 'signals-b', kpiProposed: 0, kpiAccepted: 0, kpiExtractionStatus: null, isOAuth: false }),
    ])
    expect(view.props.repos).toEqual([{ id: 'repo-a', fullName: 'sample/app', defaultBranch: 'main' }])
    expect(counts).toHaveBeenCalledExactlyOnceWith('sql-a')
    expect(latest).toHaveBeenCalledExactlyOnceWith('sql-a')
    expect(admin.calls).toContainEqual(['notification_channels', 'in', 'org_id', ['org-a', 'org-b']])
  })
})
