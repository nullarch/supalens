'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { BaseModal, ModalButton } from '@/components/modals'
import { addWidgetToDashboard, createDashboard, listDashboardsForPicker } from '@/lib/dashboards/actions'
import type { DashboardSummary } from '@/lib/dashboards/types'
import { reportCreationResult, reportPickerRows, reportSaveScope, reportWidgetResult } from '@/lib/dashboards/save-result'
import s from './AddToDashboard.module.css'

export interface SaveToReportActions {
  list: typeof listDashboardsForPicker
  create: typeof createDashboard
  add: typeof addWidgetToDashboard
}

/** Real save actions by default; local adapters are used only by the dev fixture. */
interface SaveProps {
  spec: unknown
  dataSourceId?: string | null
  compact?: boolean
  actions?: SaveToReportActions
}

export function AddToDashboard(props: SaveProps) {
  return <SaveToReport key={reportSaveScope(props.spec, props.dataSourceId)} {...props} />
}

function SaveToReport({ spec, dataSourceId, compact, actions }: SaveProps) {
  const t = useTranslations('appDashboards')
  const common = useTranslations('appCommon')
  const io = actions ?? { list: listDashboardsForPicker, create: createDashboard, add: addWidgetToDashboard }
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<DashboardSummary[] | null>(null)
  const [busy, setBusy] = useState<'loading' | 'saving' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<DashboardSummary | null>(null)
  const [saved, setSaved] = useState<DashboardSummary | null>(null)
  const [uncertain, setUncertain] = useState<{ target: DashboardSummary | null; stage: 'create' | 'save' } | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function load() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy('loading'); setError(null)
    try {
      const rows = reportPickerRows(await io.list())
      if (!mounted.current) return
      setList(rows)
      if (rows === null) setError(t('add.loadFailed'))
    }
    catch { if (mounted.current) { setList(null); setError(t('add.loadFailed')) } }
    finally { if (mounted.current) { inFlight.current = false; setBusy(null) } }
  }

  function show() {
    if (inFlight.current) return
    setSaved(null); setError(null); setOpen(true)
    // Closing a dialog or rereading the list cannot establish whether a widget was saved.
    if (uncertain) return
    // Reload each time: saved reports may have been changed in another view.
    void load()
  }

  function failure(result: { reason?: string; message?: string }) {
    return result.reason === 'unconfigured' ? t('add.needsSupabase') : result.message ?? t('add.addFailed')
  }

  async function save(destination?: DashboardSummary) {
    if (inFlight.current || uncertain) return
    inFlight.current = true
    setBusy('saving'); setError(null)
    let target = destination ?? created
    let stage: 'create' | 'save' = target ? 'save' : 'create'
    try {
      if (!target) {
        const result = reportCreationResult(await io.create(t('newDashboardName')))
        if (!mounted.current) return
        if (result.kind === 'rejected') { setError(failure(result)); return }
        if (result.kind === 'unknown') { setUncertain({ target: null, stage }); return }
        target = { ...result.data, name: t('newDashboardName'), pinned: false, position: 0 }
        // Keep the confirmed new report across add failures. Retry must not create another.
        setCreated(target)
        setList(previous => [...(previous ?? []), target!])
      }
      stage = 'save'
      const result = reportWidgetResult(await io.add(target.id, { spec, dataSourceId }))
      if (!mounted.current) return
      if (result.kind === 'rejected') { setError(failure(result)); return }
      if (result.kind === 'unknown') { setUncertain({ target, stage }); return }
      setSaved(target); setCreated(null)
    } catch {
      // A lost response cannot prove that the write did not happen.
      if (mounted.current) setUncertain({ target, stage })
    } finally { if (mounted.current) { inFlight.current = false; setBusy(null) } }
  }

  return <>
    <button ref={trigger} type="button" onClick={show} className={compact ? s.iconButton : s.button}
      aria-label={t('saveToReport')} title={compact ? t('saveToReport') : undefined}
      aria-haspopup="dialog" aria-expanded={open}>
      <Plus size={14} aria-hidden />
      {!compact && t('saveToReport')}
    </button>
    {open && <BaseModal open title={t('saveToReport')} description={t('add.description')} size="md" className={s.dialog}
      onClose={() => { if (!inFlight.current) setOpen(false) }} closeDisabled={!!busy}
      onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}
      footer={<ModalButton variant="ghost" disabled={!!busy} onClick={() => setOpen(false)}>{common('close')}</ModalButton>}>
      <div className={s.body} aria-busy={!!busy}>
        {busy && <p role="status">{busy === 'loading' ? t('add.loading') : common('processing')}</p>}
        {error && <p className={s.error} role="alert">{error}</p>}
        {uncertain ? <div className={s.result}>
          <p className={s.error} role="alert">{t(uncertain.stage === 'create' ? 'add.createUnconfirmed' : 'add.saveUnconfirmed')}</p>
          <p>{t('add.reviewBeforeRetry')}</p>
          <Link className="dx-btn" href={uncertain.target ? `/app/dashboards/${uncertain.target.slug}` : '/app/dashboards'}>{t('add.reviewReports')}</Link>
        </div> : saved ? <div className={s.result}>
          <p role="status">{t('add.savedTo', { name: saved.name })}</p>
          <Link className="dx-btn" href={`/app/dashboards/${saved.slug}`}>{t('index.open')}</Link>
        </div> : <>
          {created && <p className={s.partial}>{t('add.createdPending', { name: created.name })} <Link href={`/app/dashboards/${created.slug}`}>{t('index.open')}</Link></p>}
          {!busy && list === null && <ModalButton variant="ghost" onClick={load}>{t('add.retryLoad')}</ModalButton>}
          {list !== null && <>
            <ul className={s.list} aria-label={t('add.chooseReport')}>
              {list.map(report => <li key={report.id}><button type="button" disabled={!!busy} onClick={() => save(report)}>
                <span>{report.name}</span><Plus size={14} aria-hidden />
              </button></li>)}
            </ul>
            {list.length === 0 && <p>{t('add.noSaved')}</p>}
            <ModalButton disabled={!!busy} onClick={() => save()}>{t(created ? 'add.retryCreated' : 'add.toNew')}</ModalButton>
          </>}
        </>}
      </div>
    </BaseModal>}
  </>
}
