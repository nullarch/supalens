import { notFound } from 'next/navigation'
import '@/app/app/dashboard.css'
import { HistoryView } from '@/components/agent/HistoryView'
import { SavedRunView } from '@/components/agent/SavedRunView'
import { SharedAnswer } from '@/components/agent/SharedAnswer'
import { AgentView, type AgentChunk } from '@/components/agent/AgentView'
import { AnalyzeClient } from '@/components/agent/AnalyzeClient'
import { AppSurface } from '@/components/dashboard/AppSurface'
import DashboardShell from '@/components/dashboard/DashboardShell'
import { SetupPill } from '@/components/onboarding/SetupPill'
import { computeActivation } from '@/lib/activation/logic'
import type { AppChrome } from '@/lib/dashboards/types'
import askPage from '@/app/app/ask/ask.module.css'
import { byKey } from '@/components/dashboard/widgets/__fixtures__/samples'
import type { HistoryRun, SavedResult } from '@/components/agent/saved-analysis'
import { SourcePreview } from './SourcePreview'
import { RunActionPreview } from './RunActionPreview'
import { AnalyzePreview } from './AnalyzePreview'

export const metadata = { title: 'Analysis design fixtures', robots: { index: false, follow: false } }
const RUN_ACTION_MODES = ['success', 'failure', 'throw', 'copy-failure', 'revoke-failure', 'revoke-throw', 'malformed', 'terminal', 'share-malformed', 'share-truthy', 'share-url', 'revoke-malformed', 'revoke-truthy', 'track-throw', 'stop-status', 'stop-http', 'stop-json', 'slow']

function visualization(key: string) {
  const sample = byKey(key)!
  return { v: 1 as const, query: { sql: 'select 3 as sample_value', queryId: 'sample-query' }, sample: { columns: sample.data.columns, rows: sample.data.rows }, chart: sample.spec }
}

const PAGE_CHROME: AppChrome = {
  dashboards: [],
  user: { name: 'Sample Person', email: 'sample@example.invalid', initials: 'SP', isAdmin: false },
  org: { id: 'sample-org', name: 'Northstar', initials: 'NS' },
  orgs: [{ id: 'sample-org', name: 'Northstar', slug: 'northstar', initials: 'NS', role: 'owner' }],
  billing: { plan: 'free', queriesUsed: 3, queriesLimit: 15, monitorsUsed: 1, monitorsLimit: 3 },
  monitors: { enabled: 1 },
}

export default async function AnalysisPreview({ searchParams }: { searchParams: Promise<{ view?: string; mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { view = 'history', mode = 'mixed' } = await searchParams
  // The chat surface in the real shell, with and without a landing banner in AnalyzeClient's
  // `children` slot (here: the SetupPill). /app/ask itself ships NO setup guide any more — the one
  // onboarding checklist lives on /app/overview — so this exercises the slot, not that page's state.
  if (view === 'page') {
    const activation = computeActivation({ realActiveSources: 1, reposAttached: 1, contextsGenerated: 0, kpisProposed: 0, kpisAccepted: 0, monitorsEnabled: 0, slackConnected: false, alertChannelConfigured: false })
    return <DashboardShell chrome={PAGE_CHROME}>
      <div className={askPage.page}>
        <AnalyzePreview mode={mode === 'no-pill' ? 'success' : mode} log={false}>
          {mode !== 'no-pill' && <SetupPill steps={activation.steps} nextStep={activation.nextStep} />}
        </AnalyzePreview>
      </div>
    </DashboardShell>
  }
  if (view === 'actions' || view === 'ask-live') {
    const allowed = view === 'actions' ? RUN_ACTION_MODES :
      ['success', 'trigger', 'failure', 'throw', 'quota', 'malformed', 'slow', 'demo', 'gate-schema', 'gate-repo', 'gate-limit', 'gate-quota', 'gate-failure', 'gate-race', 'gate-poll', 'gate-conflict', 'gate-read-error']
    if (!allowed.includes(mode)) notFound()
    return <AppSurface>
      <main style={{ maxWidth: 1280, padding: '24px 20px', margin: '0 auto' }}>
        <p className="dx-label" style={{ marginBottom: 20 }}>DESIGN FIXTURE · Local responses only · No real analysis, sharing, clipboard or account writes.</p>
        {view === 'actions' ? <RunActionPreview key={mode} mode={mode} /> : <AnalyzePreview key={mode} mode={mode} />}
      </main>
    </AppSurface>
  }
  if (!['history', 'run', 'shared', 'source', 'stream', 'composer'].includes(view)) notFound()
  if (!['mixed', 'empty', 'filtered', 'error', 'legacy', 'page2', 'succeeded', 'failed', 'cancelled', 'queued', 'running', 'unknown', 'charts-only', 'invalid', 'thinking'].includes(mode)) notFound()
  const question = `How do completed payments relate to active entitlements? ${'InternationalSubscriptionReconciliation_'.repeat(4)}`
  const rows: HistoryRun[] = ['succeeded', 'running', 'queued', 'failed', 'cancelled', 'unknown'].map((status, i) => ({
    id: `sample-${i}`, question: i === 0 ? question : `${status}: sample question`, status,
    created_at: `2026-09-07T12:0${5 - i}:00Z`, ended_at: ['queued', 'running'].includes(status) ? null : `2026-09-07T12:0${5 - i}:01.250Z`,
    user_id: 'sample-user', data_source_id: 'sample-source', channel: i > 3 ? 'incident' : 'web',
    data_sources: { name: 'Northstar production / business events' },
  }))
  if (mode === 'invalid') { rows[0].created_at = 'invalid'; rows[0].ended_at = 'invalid' }
  const result: SavedResult | null = mode === 'empty' ? null : {
    text: mode === 'charts-only' ? '' : `Sample output, not a customer result.\n\nThree completed payments have no matching entitlement in this example. This observation does not establish a root cause.\n\n${'sample_identifier_'.repeat(24)}`,
    visualizations: mode === 'invalid' ? [null, { invalid: true }] : [visualization('kpi'), visualization('line')],
  }
  const chunks: AgentChunk[] = mode === 'thinking' || mode === 'empty' ? [] : [
    { type: 'text', text: 'Sample analysis output. A missing entitlement does not establish a root cause.' },
    { type: 'tool_use', tool: 'execute_sql', input: { sql: `select '${'sample_value_'.repeat(30)}' as example` } },
    { type: 'visualization', spec: visualization('kpi') },
  ]
  const body = <>
    <p className={view === 'shared' ? undefined : 'dx-label'} style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 20 }}>DESIGN FIXTURE · Sample data · No analysis, sharing or account writes.</p>
    {view === 'history' && <HistoryView rows={mode === 'empty' || mode === 'page2' ? [] : mode === 'filtered' ? rows.filter(row => row.channel === 'incident') : rows}
      page={mode === 'page2' ? 2 : 1} hasNext={mode !== 'empty'} channelAvailable={mode !== 'legacy'} filtered={mode === 'filtered'} loadError={mode === 'error'} incidentByRun={{ 'sample-4': 'sample-incident' }} />}
    {view === 'run' && <SavedRunView run={{ question, status: mode === 'mixed' || mode === 'empty' || mode === 'charts-only' || mode === 'invalid' ? 'succeeded' : mode, result, error: mode === 'failed' ? `Sample failure: ${'diagnostic_'.repeat(25)}` : null, created_at: mode === 'invalid' ? 'invalid' : '2026-09-07T12:00:00Z', data_sources: { name: 'Northstar / production' } }} />}
    {view === 'shared' && <SharedAnswer question={question} result={result} />}
    {view === 'source' && <SourcePreview />}
    {view === 'stream' && <div style={{ maxWidth: 768, margin: '0 auto' }}><AgentView chunks={chunks} phase={mode === 'thinking' ? 'streaming' : mode === 'error' ? 'error' : 'done'} readOnly /></div>}
    {view === 'composer' && <div inert><AnalyzeClient dataSources={[{ id: 'sample-demo', name: 'Sample data', isDemo: true }]} /></div>}
  </>
  // The public share page renders outside /app with the global tokens — preview it that way.
  // Every other view is an /app surface and gets the app scope (tokens + fonts).
  if (view === 'shared') return <div style={{ maxWidth: 1280, padding: '24px 20px', margin: '0 auto' }}>{body}</div>
  return <AppSurface><div style={{ maxWidth: 1280, padding: '24px 20px', margin: '0 auto' }}>{body}</div></AppSurface>
}
