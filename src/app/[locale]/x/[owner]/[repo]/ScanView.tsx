'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRealtimeRunWithStreams } from '@trigger.dev/react-hooks'
import { Check } from 'lucide-react'

import { useRouter } from '@/i18n/navigation'
import {
  initialScanState,
  reduceScanEvents,
  scanProgress,
  type XrayEvent,
  type XrayScanState,
} from '@/lib/xray/events'
import { productNameFor } from '@/lib/xray/repo-ref'
import RescanButton from './RescanButton'
import s from './scan.module.css'

type Phase = 'running' | 'done' | 'failed'

interface StatusPayload {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  fileCount: number | null
  errorCode: string | null
  triggerRunId: string | null
  publicToken: string | null
}

const POLL_MS = 4000
const FAILED_COPY = new Set(['clone_failed', 'budget', 'no_report'])

/**
 * The live scan. Two channels, deliberately redundant: the Trigger Realtime stream (what the
 * agent is reading, as it happens) and a 4s status poll of /api/xray/<id> (the source of truth
 * for done/failed, and the way to get a stream token after a reload). When the poll says
 * succeeded, the page refreshes into the report.
 */
export default function ScanView({ scanId, fullName, branch }: { scanId: string; fullName: string; branch: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [stream, setStream] = useState<{ runId: string; token: string } | null>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const res = await fetch(`/api/xray/${scanId}`, { cache: 'no-store' })
        if (res.ok) {
          const data = (await res.json()) as StatusPayload
          if (!alive) return
          setStatus(data)
          if (data.triggerRunId && data.publicToken) {
            const runId = data.triggerRunId
            const token = data.publicToken
            setStream((previous) => previous ?? { runId, token })
          }
          if (data.status === 'succeeded') {
            timer = setTimeout(() => router.refresh(), 900)
            return
          }
          if (data.status === 'failed') return
        }
      } catch {
        /* transient — keep polling */
      }
      if (alive) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [scanId, router])

  const phase: Phase = status?.status === 'succeeded' ? 'done' : status?.status === 'failed' ? 'failed' : 'running'
  const base = { ...initialScanState(), filesTotal: status?.fileCount ?? null }
  const panel = { fullName, branch, phase, errorCode: status?.errorCode ?? null }

  if (stream) return <LiveScan runId={stream.runId} token={stream.token} base={base} panel={panel} />
  return <ScanPanel {...panel} state={base} />
}

function LiveScan({
  runId,
  token,
  base,
  panel,
}: {
  runId: string
  token: string
  base: XrayScanState
  panel: { fullName: string; branch: string; phase: Phase; errorCode: string | null }
}) {
  const { streams } = useRealtimeRunWithStreams(runId, { accessToken: token })
  const events = (streams as Record<string, unknown[]> | undefined)?.xray
  const state = useMemo(() => {
    const reduced = reduceScanEvents((events ?? []) as XrayEvent[])
    return { ...reduced, filesTotal: reduced.filesTotal ?? base.filesTotal }
  }, [events, base.filesTotal])
  return <ScanPanel {...panel} state={panel.phase === 'done' ? { ...state, stage: 6 } : state} />
}

/** Presentational — also rendered by the /dev/xray preview with fixture events. */
export function ScanPanel({
  fullName,
  branch,
  phase,
  errorCode,
  state,
}: {
  fullName: string
  branch: string
  phase: Phase
  errorCode: string | null
  state: XrayScanState
}) {
  const t = useTranslations('xray.scan')
  const [ownerPart, repoPart] = fullName.split('/')
  const name = productNameFor(ownerPart ?? fullName, repoPart ?? fullName)
  const steps = t.raw('steps') as { title: string; detail: string }[]
  const progress = phase === 'done' ? 100 : scanProgress(state)
  const stage = phase === 'done' ? 6 : state.stage
  const failedCopy = errorCode && FAILED_COPY.has(errorCode) ? t(`failed.${errorCode}`) : t('failed.other')

  return (
    <section className={`ed-wide ${s.scan}`} aria-labelledby="xray-scan-title">
      <div className={s.side}>
        <div className={s.repo}>
          <span className={s.avatar} aria-hidden>
            {fullName.slice(0, 2).toLowerCase()}
          </span>
          <div className={s.repoText}>
            <span className={s.repoName}>{fullName.replace('/', ' / ')}</span>
            <span className={s.repoMeta}>
              {state.filesTotal ? t('meta', { branch, files: state.filesTotal }) : t('metaWaiting', { branch })}
            </span>
          </div>
        </div>
        <h1 id="xray-scan-title" className={s.title}>
          {t('title', { name })}
        </h1>

        <ol className={s.steps}>
          {steps.map((step, index) => {
            const number = index + 1
            const stepState = phase === 'failed' && number >= stage ? 'pending' : number < stage ? 'done' : number === stage ? 'active' : 'pending'
            const detail = number === 1 && state.filesTotal ? t('fetchedDetail', { files: state.filesTotal }) : step.detail
            return (
              <li key={step.title} className={s.step} data-state={stepState} aria-current={stepState === 'active' ? 'step' : undefined}>
                <span className={s.stepIcon} aria-hidden>
                  {stepState === 'done' ? <Check size={13} strokeWidth={3} /> : stepState === 'active' ? <span className={s.spinner} /> : null}
                </span>
                <span className={s.stepText}>
                  <span className={s.stepTitle}>{step.title}</span>
                  <span className={s.stepDetail}>{detail}</span>
                </span>
              </li>
            )
          })}
        </ol>

        {phase === 'failed' ? (
          <div className={s.failed} role="alert">
            <p className={s.failedTitle}>{t('failedTitle')}</p>
            <p className={s.failedBody}>
              {failedCopy} {t('failedNote')}
            </p>
            <RescanButton repo={fullName.toLowerCase()} label={t('retry')} />
          </div>
        ) : (
          <div className={s.progress}>
            <div className={s.progressRow}>
              <span>{phase === 'done' ? t('done') : stage >= 5 ? t('etaLate') : t('eta')}</span>
              <span className={s.mono}>{t('filesRead', { count: state.filesRead })}</span>
            </div>
            <div
              className={s.bar}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label={t('title', { name })}
            >
              <span className={s.barFill} style={{ width: `${progress}%` }} />
            </div>
            <p className={s.keepOpen}>{t('keepOpen')}</p>
          </div>
        )}
      </div>

      <div className={s.live}>
        <div className={s.liveHead}>
          <span className={s.liveTag}>
            <span className={phase === 'running' ? `${s.liveDot} ${s.liveDotOn}` : s.liveDot} aria-hidden />
            {t('live')}
          </span>
          <span className={s.liveNote}>{t('readOnly')}</span>
        </div>
        <ol className={s.log} aria-live="polite" aria-relevant="additions">
          {state.log.length === 0 && <li className={s.logWaiting}>{t('waitingLog')}</li>}
          {state.log.map((line, index) => (
            <li key={`${index}-${line.text}`} className={s.logLine} data-kind={line.kind}>
              <span className={s.logKind}>{t(`log.${line.kind}`)}</span>
              <span className={s.logText}>{line.text}</span>
            </li>
          ))}
          {phase === 'running' && state.lastRead && (
            <li className={s.logLine} data-kind="now" aria-hidden>
              <span className={s.logKind}>…</span>
              <span className={s.caret}>▍</span>
            </li>
          )}
        </ol>
        <dl className={s.counters}>
          {(['entity', 'rule', 'kpi', 'trap'] as const).map((kind) => (
            <div key={kind} className={s.counter} data-kind={kind}>
              <dt>{t(`counters.${kind}`, { count: state.counts[kind] })}</dt>
              <dd>{state.counts[kind]}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
