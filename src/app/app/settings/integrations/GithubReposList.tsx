'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GitBranch, Play } from 'lucide-react'
import { AgentStream } from '@/components/agent/AgentStream'
import { Select } from '@/components/ui/Select'
import { settingsSaveResult } from '../save-result'
import { captureSettingsFocus, restoreSettingsFocus } from '../settings-focus'
import { toggleRepoAnalysisAction } from './actions'
import { repoAnalysisResult } from './presentation'
import s from './integrations.module.css'

export interface GithubRepoItem { id: string; full_name: string; default_branch: string; analysis_enabled: boolean }
export interface CrossDataSource { id: string; name: string }
type ActiveRun = { repoId: string; repoName: string; sourceName: string; triggerRunId: string; publicToken: string }
type StartInput = { repoId: string; dataSourceId?: string }
type StartResponse = { ok: boolean; status?: number; data: unknown }
type Notice = { kind: 'ok' | 'err' | 'info'; text: string }

async function startAnalysis(input: StartInput): Promise<StartResponse> {
  const response = await fetch('/api/code/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  return { ok: response.ok, status: response.status, data: await response.json() }
}

export function GithubReposList({ repos, dataSources = [], canEdit = true, unavailable = false, toggleAction = toggleRepoAnalysisAction,
  analyzeAction = startAnalysis, refresh, renderRun, reloadHref = '/app/settings/integrations',
}: {
  repos: GithubRepoItem[]; dataSources?: CrossDataSource[]; canEdit?: boolean; unavailable?: boolean
  toggleAction?: (data: FormData) => Promise<unknown>; analyzeAction?: (input: StartInput) => Promise<StartResponse>
  refresh?: () => void; renderRun?: (run: ActiveRun, onDone: (phase: 'done' | 'error') => void) => ReactNode; reloadHref?: string
}) {
  const t = useTranslations('appIntegrations')
  const common = useTranslations('appCommon')
  const router = useRouter()
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<{ kind: 'toggle' | 'analyze'; id: string } | null>(null)
  const [paused, setPaused] = useState(false)
  const [run, setRun] = useState<ActiveRun | null>(null)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [crossDsId, setCrossDsId] = useState('')
  const locked = useRef(false)
  const mounted = useRef(true)
  const origin = useRef<ReturnType<typeof captureSettingsFocus> | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!pending) { restoreSettingsFocus(origin.current); origin.current = null } }, [pending])
  const enabled = (repo: GithubRepoItem) => saved[repo.id] ?? repo.analysis_enabled
  const disabled = !canEdit || unavailable || !!pending || paused || running
  const validSource = !crossDsId || dataSources.some(source => source.id === crossDsId)
  function begin(kind: 'toggle' | 'analyze', repo: GithubRepoItem) {
    if (disabled || locked.current || !repos.some(item => item.id === repo.id)) return false
    locked.current = true; origin.current = captureSettingsFocus(); setPending({ kind, id: repo.id }); setNotice(null)
    return true
  }
  function finish() { locked.current = false; if (mounted.current) setPending(null) }
  async function toggle(repo: GithubRepoItem) {
    if (!begin('toggle', repo)) return
    const next = !enabled(repo), fd = new FormData()
    fd.set('repoId', repo.id); fd.set('enabled', String(next))
    let response: unknown
    try { response = await toggleAction(fd) } catch { response = undefined }
    if (!mounted.current) { finish(); return }
    const outcome = settingsSaveResult(response)
    if (outcome.kind === 'confirmed') {
      setSaved(previous => ({ ...previous, [repo.id]: next }))
      setNotice({ kind: 'ok', text: t('repoSaved', { repo: repo.full_name }) })
      try { (refresh ?? router.refresh)() } catch { setNotice({ kind: 'info', text: t('repoRefreshFailed') }) }
    } else {
      setPaused(outcome.kind === 'unconfirmed')
      setNotice({ kind: 'err', text: t(outcome.kind === 'unconfirmed' ? 'repoUnconfirmed' : 'repoSaveFailed') })
    }
    finish()
  }
  async function analyze(repo: GithubRepoItem) {
    if (!validSource || !begin('analyze', repo)) return
    try {
      const outcome = repoAnalysisResult(await analyzeAction({ repoId: repo.id, dataSourceId: crossDsId || undefined }))
      if (!mounted.current) return
      if (outcome.kind === 'started') {
        setRun({ repoId: repo.id, repoName: repo.full_name, sourceName: dataSources.find(source => source.id === crossDsId)?.name ?? t('codeOnly'), ...outcome.run })
        setRunning(true)
        setNotice({ kind: 'info', text: t('repoQueued') })
      } else if (outcome.kind === 'rejected') {
        setNotice({ kind: 'err', text: outcome.reason === 'triggerRequired' ? t('errors.triggerRequired') : t(`repoErrors.${outcome.reason}`) })
      } else { setPaused(true); setNotice({ kind: 'err', text: t('repoStartUnconfirmed') }) }
    } catch { if (mounted.current) { setPaused(true); setNotice({ kind: 'err', text: t('repoStartUnconfirmed') }) } }
    finally { finish() }
  }
  function done(phase: 'done' | 'error') {
    setRunning(false)
    if (phase === 'error') { setPaused(true); setNotice({ kind: 'err', text: t('repoRunUnconfirmed') }) }
    else setNotice({ kind: 'ok', text: t('repoRunFinished') })
  }
  if (!repos.length) return <p className={s.empty}>{t('empty')}</p>
  return <section className={s.repositorySection} aria-label={t('repoSection')} data-setting="repositories" aria-busy={!!pending}>
    {(!canEdit || unavailable) && <div className={s.repoNotes}>
      {!canEdit && <p className={s.actionNote}>{t('repoReadOnly')}</p>}
      {unavailable && <p className={s.actionNote}>{t('repoConnectionUnavailable')}</p>}
    </div>}
    {/* what the App may read (left) and what an on-demand run analyzes against (right) */}
    <div className={s.repoToolbar}>
      <p className={s.scopeLine}><code>{t('scope')}</code><span>{t('scopeNote')}</span></p>
      {(dataSources.length > 0 || crossDsId) && <div className={s.crossRow}>
        <span>{t('crossDbLabel')}</span>
        <Select size="sm" value={crossDsId} disabled={disabled} onValueChange={setCrossDsId} ariaLabel={t('crossDbLabel')}
          options={[{ value: '', label: t('codeOnly') }, ...dataSources.map(source => ({ value: source.id, label: source.name }))]} />
      </div>}
    </div>
    {!validSource && <p className={s.streamErr} role="alert">{t('repoSourceUnavailable')}</p>}
    <ul className={s.repoList}>
      {repos.map(repo => <li key={repo.id} className={s.repoRow}>
        <span className={s.repoIdentity}><span className={s.repoName}>{repo.full_name}</span><span className={s.repoBranch}><GitBranch size={12} strokeWidth={2} aria-hidden /><span>{repo.default_branch}</span></span></span>
        <span className={s.repoRight}>
          <button type="button" className={s.analyzeBtn} disabled={disabled || !validSource} onClick={() => void analyze(repo)} aria-label={t('repoAnalyzeLabel', { repo: repo.full_name })}>
            <Play size={13} strokeWidth={2} aria-hidden />
            {pending?.kind === 'analyze' && pending.id === repo.id ? t('analyze.starting') : crossDsId ? t('analyze.codeAndDb') : t('analyze.code')}
          </button>
          <span className={s.repoToggle} data-repo-toggle>
            <span className={s.toggleLabel}>{pending?.kind === 'toggle' && pending.id === repo.id ? common('processing') : enabled(repo) ? t('toggle.on') : t('toggle.off')}</span>
            <button type="button" role="switch" aria-checked={enabled(repo)} aria-label={t(enabled(repo) ? 'toggle.ariaOff' : 'toggle.ariaOn', { repo: repo.full_name })}
              disabled={disabled} className={`${s.toggle} ${enabled(repo) ? s.toggleOn : ''}`} onClick={() => void toggle(repo)}><span className={s.toggleKnob} /></button>
          </span>
        </span>
      </li>)}
    </ul>
    {notice && <p tabIndex={-1} data-save-notice role={notice.kind === 'err' ? 'alert' : 'status'} className={s.scopeNotice} data-kind={notice.kind}>{notice.text}</p>}
    {paused && <a className={s.link} href={reloadHref}>{t('reloadSettings')}</a>}
    {run && <div className={s.repoRun}>
      <h3>{t('repoRunTitle', { repo: run.repoName })}</h3><p className={s.actionNote}>{run.sourceName}</p>
      {renderRun ? renderRun(run, done) : <AgentStream key={run.triggerRunId} runId={run.triggerRunId} accessToken={run.publicToken} onDone={phase => done(phase === 'done' ? 'done' : 'error')} />}
    </div>}
  </section>
}
