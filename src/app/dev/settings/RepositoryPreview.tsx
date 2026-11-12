'use client'

import { useState } from 'react'
import { GithubReposList } from '@/app/app/settings/integrations/GithubReposList'
import { IntegrationReturnNotice } from '@/app/app/settings/integrations/IntegrationReturnNotice'

/** Local actions and stream slot only. Never starts a real analysis or subscription. */
export function RepositoryPreview({ mode }: { mode: string }) {
  const [workspace, setWorkspace] = useState('A')
  const [sources, setSources] = useState(true)
  const [calls, setCalls] = useState<unknown[]>([])
  const [attempt, setAttempt] = useState(0)
  const delay = () => new Promise(resolve => setTimeout(resolve, mode === 'pending' ? 900 : 50))
  const repoName = mode === 'long' ? 'northstar/' + 'sample-repository-'.repeat(15) : 'northstar/payments'
  return <>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
      <button type="button" className="dx-btn dx-btn-ghost" onClick={() => setWorkspace(previous => previous === 'A' ? 'B' : 'A')}>Switch sample workspace</button>
      <button type="button" className="dx-btn dx-btn-ghost" onClick={() => setSources(false)}>Remove sample source</button>
    </div>
    <p data-repo-workspace>{workspace}</p>
    <GithubReposList key={workspace} repos={mode === 'empty' ? [] : [
      { id: `repo-${workspace}-1`, full_name: repoName, default_branch: mode === 'long' ? 'branch-'.repeat(35) : 'main', analysis_enabled: true },
      { id: `repo-${workspace}-2`, full_name: 'northstar/worker', default_branch: 'main', analysis_enabled: false },
    ]} dataSources={sources ? [{ id: `db-${workspace}`, name: mode === 'long' ? 'Sample database '.repeat(20) : 'Sample DB' }] : []}
      canEdit={mode !== 'viewer'} reloadHref="/dev/settings?view=repository-actions&mode=success"
      toggleAction={async data => {
        setCalls(previous => [...previous, { action: 'toggle', repoId: data.get('repoId'), enabled: data.get('enabled') }]); await delay()
        if (mode === 'throw') throw new Error('private fixture error')
        if (mode === 'failure') return { ok: false, message: 'private fixture error' }
        if (mode === 'malformed') return null
        return { ok: true }
      }} refresh={() => { if (mode === 'refresh-failure') throw new Error('private refresh error') }}
      analyzeAction={async input => {
        setCalls(previous => [...previous, { action: 'analyze', ...input }]); await delay()
        if (mode === 'throw') throw new Error('private transport error')
        if (mode === 'malformed') return { ok: true, data: { mode: 'trigger', runId: 'incomplete' } }
        if (mode === 'failure' || (mode === 'retry' && attempt > 0)) return { ok: false, status: 400, data: { error: 'private fixture error' } }
        if (mode === 'quota') return { ok: false, status: 402, data: { error: 'quota_exceeded' } }
        if (mode === 'trigger') return { ok: false, status: 503, data: { error: 'trigger_required' } }
        if (mode === 'server-error') return { ok: false, status: 502, data: { error: 'trigger_failed' } }
        setAttempt(previous => previous + 1)
        return { ok: true, data: { mode: 'trigger', runId: 'sample-run', triggerRunId: `sample-trigger-${attempt}`, publicToken: 'not-a-real-token' } }
      }} renderRun={(run, done) => <div data-repo-run style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 16 }}>
        <p>Sample stream · {run.repoName} · {run.sourceName}</p>
        <button type="button" data-fixture-control className="dx-btn" onClick={() => done(mode === 'stream-error' ? 'error' : 'done')}>Finish sample run</button>
      </div>} />
    <section style={{ marginTop: 32 }} aria-label="Return banner samples">
      <IntegrationReturnNotice params={mode === 'banner-error' ? { error: 'private server detail <script>sample</script>' }
        : mode === 'banner-cancel' ? { error: 'access_denied' }
          : mode === 'banner-restart' ? { error: 'invalid_state' }
            : mode === 'banner-claimed' ? { error: 'workspace_already_connected' }
              : mode === 'banner-import' ? { connecting: 'supabase', skipped: '2' }
                : mode === 'banner-invalid' ? { connected: ['github'], repos: 'NaN' }
                  : { connected: 'github', repos: 'NaN', team: 'private URL text' }} />
    </section>
    <details><summary>Local fixture calls</summary><output data-repo-calls>{JSON.stringify(calls)}</output></details>
  </>
}
