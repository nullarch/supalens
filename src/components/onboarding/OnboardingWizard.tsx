'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import * as Dialog from '@radix-ui/react-dialog'

import { WidgetRenderer } from '@/components/dashboard/widgets'
import { DirectDataSourceForm } from '@/components/data-sources/DirectDataSourceForm'
import { FirestoreDataSourceForm } from '@/components/data-sources/FirestoreDataSourceForm'
import { completeWizard } from '@/lib/onboarding/actions'
import {
  WIZARD_TOTAL_STEPS,
  actAfterConnect,
  exitCompletes,
  initialAct,
  kpiActVariant,
  wizardDismissKey,
  type WizardAct,
  type WizardMode,
} from '@/lib/onboarding/logic'
import { track } from '@/utils/analytics'
import { WizardReplay } from './WizardReplay'
import { WizardExtraction } from './WizardExtraction'
import { requestWizardExtraction, type WizardExtractRequest } from './wizard-extraction-request'
import { useIntegrations } from '@/components/integrations/IntegrationsContext'
import s from './OnboardingWizard.module.css'
import { isRecoveryId } from '@/lib/alerts/recovery'

// First-login 4-act onboarding wizard (full-screen overlay on /app/ask).
// Act 1: watch a canned analysis replay · Act 2: connect a real source · Act 3: attach the code
// that gives the DB its meaning (only when a DB exists) · Act 4: propose Auto-KPI.
// Two kinds of exit (logic.ts::exitCompletes): COMPLETING the last act stamps
// profiles.wizard_completed_at; ✕ / ESC / skips only DISMISS — remembered per user+browser in
// localStorage so the overlay doesn't nag, while the SetupPill keeps offering the remaining steps.
// Every skip moves FORWARD (no back navigation). Invitees whose org already has real sources get
// mode='tour' (Act 1 only): we never ask them to connect a database to someone else's org.

export interface WizardProps {
  mode: WizardMode
  /** `?wizard=resume` — returning from the Supabase OAuth round-trip (returnTo carries it). */
  resume: boolean
  /** JSON-safe VisualizationSpec envelopes (canned demo catalog, localized titles, samples inline). */
  replayStatSpec: unknown
  replayChartSpec: unknown
  sampleSpecs: unknown[]
  /** Real (non-demo) sources in the org — updates via router.refresh() after a connect. */
  realSources: { id: string; name: string }[]
  /** Keys the per-browser dismissal (so a shared machine never hides it for another user). */
  userId?: string
  /** Local fixture seam. Production retains its existing API, completion and navigation. */
  io?: {
    extract: WizardExtractRequest
    complete: () => void | Promise<void>
    refresh: () => void
    navigate: (href: string) => void
  }
}

type ConnectForm = 'postgres' | 'mysql' | 'firestore'

export function OnboardingWizard(props: WizardProps) {
  const t = useTranslations('appWizard')
  const integrations = useIntegrations()
  const router = useRouter()
  // The shared return card must remain visible, not obscured by the onboarding dialog.
  // This does not mark onboarding complete; the user continues via the card's next step.
  const showingOAuthResult = isRecoveryId(useSearchParams().get('supabaseConnection'))
  const io = props.io ?? { extract: requestWizardExtraction, complete: completeWizard, refresh: () => router.refresh(), navigate: (href: string) => router.push(href) }
  const hasReal = props.realSources.length > 0
  const dismissKey = wizardDismissKey(props.userId ?? 'anonymous')

  // Render nothing until the per-browser dismissal has been read (avoids a flash for dismissed users).
  const [ready, setReady] = useState(false)
  const [closed, setClosed] = useState(false)
  const [act, setAct] = useState<WizardAct>(() =>
    props.mode === 'tour' ? 1 : initialAct({ resume: props.resume, hasRealSources: hasReal }),
  )
  const [replayDone, setReplayDone] = useState(false)
  // Act 3 is "attach a repository"; without the GitHub App there is nothing to attach.
  useEffect(() => {
    if (act === 3 && !integrations.github) setAct(4)
  }, [act, integrations.github])
  const [form, setForm] = useState<ConnectForm | null>(null)
  const [formBusy, setFormBusy] = useState(false)
  const [connectedName, setConnectedName] = useState<string | null>(null)
  const [extractBusy, setExtractBusy] = useState(false)
  const finishedRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = !!localStorage.getItem(dismissKey)
    } catch {
      /* localStorage unavailable — show it */
    }
    // A resume from the OAuth round-trip re-opens the wizard even if it was dismissed earlier.
    if (dismissed && !props.resume) setClosed(true)
    else track('wizard_viewed', { mode: props.mode, resume: props.resume })
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = ready && !closed && !showingOAuthResult

  // A new act starts at its heading, not at a control removed by the previous act.
  // Radix owns modal focus containment, background isolation and scroll locking.
  useEffect(() => {
    panelRef.current?.focus()
  }, [act])

  // Act 2 → connected detection. Both connect paths end in a server-data refresh (the inline
  // forms call router.refresh(); the OAuth round-trip re-renders the page), so a real source
  // appearing in props WHILE act 2 is open means the user just connected: toast, then advance to
  // the code step.
  useEffect(() => {
    if (!visible || act !== 2 || !hasReal) return
    setConnectedName(props.realSources[0]?.name ?? null)
    track('wizard_act2_connected')
    const id = setTimeout(() => setAct(actAfterConnect({ hasRealSources: true })), 1400)
    return () => clearTimeout(id)
  }, [visible, act, hasReal, props.realSources])

  function finish(reason: string, nav?: string) {
    if (finishedRef.current) return
    finishedRef.current = true
    track('wizard_finished', { reason, act, completes: exitCompletes(reason) })
    setClosed(true)
    if (exitCompletes(reason)) {
      // Fire-and-forget stamp; refresh so the server stops sending wizard props. Navigation (if
      // any) happens immediately — the stamp is idempotent and RLS-scoped, so a race is harmless.
      // Closing the tutorial is not an acknowledgement of a persisted profile write.
      // A rejected background stamp must not become an unhandled client exception.
      void Promise.resolve().then(() => io.complete()).then(() => io.refresh()).catch(() => {})
    } else {
      try {
        localStorage.setItem(dismissKey, new Date().toISOString())
      } catch {
        /* ignore — the overlay is closed for this session either way */
      }
    }
    if (nav) io.navigate(nav)
  }

  if (!visible) return null

  const variant = kpiActVariant({ hasRealSources: hasReal })
  const firstSourceId = props.realSources[0]?.id
  const busy = formBusy || extractBusy

  return (
    <Dialog.Root open={visible} onOpenChange={(open) => { if (!open && !busy) finish('dismissed') }}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.scrim} />
        <Dialog.Content
          className={s.panel}
          ref={panelRef}
          tabIndex={-1}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            event.preventDefault()
            panelRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault()
              returnFocus.current.focus()
            }
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (busy || (event.target instanceof Element && event.target.closest('[role="listbox"]'))) event.preventDefault()
          }}
        >
          <Dialog.Title className="sr-only">{t('aria')}</Dialog.Title>
          {/* Top row: numbered steps (full mode) · close */}
          <div className={s.top}>
            {props.mode === 'full' ? (
              <div className={s.dots}>
                <span className={s.stops} aria-hidden>
                  {([1, 2, 3, 4] as const).map((n) => (
                    <span key={n} className={s.stop}>
                      {n > 1 && <span className={s.connector} data-done={n <= act} />}
                      <span className={`${s.dot} ${n === act ? s.dotOn : n < act ? s.dotDone : ''}`}>
                        {String(n).padStart(2, '0')}
                      </span>
                    </span>
                  ))}
                </span>
                <span className={s.stepNum} role="status">{t('step', { n: act, total: WIZARD_TOTAL_STEPS })}</span>
              </div>
            ) : (
              <span className={s.topLabel} aria-hidden>{t('aria')}</span>
            )}
            <button type="button" className={s.close} onClick={() => finish('dismissed')} disabled={busy} aria-label={t('close')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {act === 1 && (
            <>
              <div className={s.spread}>
                <header className={s.head}>
                  <h2 className={s.title}>{t('act1.title')}</h2>
                  <p className={s.sub}>{t('act1.sub')}</p>
                  <div className={s.replayTag}>
                    <span className={s.replayTagDot} aria-hidden />
                    {t('act1.replayTag')}
                  </div>
                </header>
                <div className={s.stage}>
                  <WizardReplay
                    question={t('act1.q')}
                    answer={t('act1.a')}
                    statSpec={props.replayStatSpec}
                    chartSpec={props.replayChartSpec}
                    onDone={() => setReplayDone(true)}
                  />
                </div>
              </div>
              <footer className={s.foot}>
                <button type="button" className={s.skip} onClick={() => (props.mode === 'tour' ? finish('act1_skipped') : (track('wizard_act1_skipped'), setAct(2)))}>
                  {t('act1.skip')}
                </button>
                {props.mode === 'tour' ? (
                  <button type="button" className={replayDone ? s.primary : s.ghost} onClick={() => finish('tour_done')}>
                    {t('act1.startTour')}
                  </button>
                ) : (
                  <button type="button" className={replayDone ? s.primary : s.ghost} onClick={() => (track('wizard_act1_done'), setAct(2))}>
                    {t('act1.next')}
                  </button>
                )}
              </footer>
            </>
          )}

          {act === 2 && (
            <>
              <div className={s.spread}>
                <header className={s.head}>
                  <h2 className={s.title}>{t('act2.title')}</h2>
                  <p className={s.sub}>{t('act2.sub')}</p>
                  {!connectedName && !form && (
                    <ul className={s.trust}>
                      <li>{t('act2.trust1')}</li>
                      <li>{t('act2.trust2')}</li>
                      <li>{t('act2.trust3')}</li>
                    </ul>
                  )}
                </header>

                <div className={s.stage}>
                  {connectedName ? (
                    <div className={s.toast} role="status">
                      <span className={s.toastOk} aria-hidden>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      </span>
                      {t('act2.connected', { name: connectedName })}
                    </div>
                  ) : form ? (
                    <div className={s.formWrap}>
                      <button type="button" className={s.back} onClick={() => setForm(null)} disabled={formBusy}>
                        {t('act2.back')}
                      </button>
                      {form === 'firestore' ? (
                        <FirestoreDataSourceForm onDone={() => router.refresh()} onBusyChange={setFormBusy} />
                      ) : (
                        <DirectDataSourceForm engine={form} onDone={() => router.refresh()} onBusyChange={setFormBusy} />
                      )}
                    </div>
                  ) : (
                    <div className={s.connectGrid}>
                      {integrations.supabaseConnect && <a
                        className={`${s.connectBtn} ${s.connectHero}`}
                        href={`/api/connect-supabase/authorize?returnTo=${encodeURIComponent('/app/ask?wizard=resume')}`}
                        onClick={() => track('wizard_act2_connect_started', { provider: 'supabase' })}
                      >
                        <span className={s.logo} aria-hidden>S</span>
                        <span className={s.connectName}>{t('act2.supabase')}</span>
                        <ArrowIcon />
                      </a>}
                      <button type="button" className={s.connectBtn} onClick={() => (track('wizard_act2_connect_started', { provider: 'postgres' }), setForm('postgres'))}>
                        <span className={s.logo} aria-hidden>P</span>
                        <span className={s.connectName}>{t('act2.postgres')}</span>
                        <ArrowIcon />
                      </button>
                      <button type="button" className={s.connectBtn} onClick={() => (track('wizard_act2_connect_started', { provider: 'mysql' }), setForm('mysql'))}>
                        <span className={s.logo} aria-hidden>M</span>
                        <span className={s.connectName}>{t('act2.mysql')}</span>
                        <ArrowIcon />
                      </button>
                      <button type="button" className={s.connectBtn} onClick={() => (track('wizard_act2_connect_started', { provider: 'firestore' }), setForm('firestore'))}>
                        <span className={s.logo} aria-hidden>F</span>
                        <span className={s.connectName}>{t('act2.firestore')}</span>
                        <ArrowIcon />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {!connectedName && (
                <footer className={s.foot}>
                  <button type="button" className={s.skip} disabled={formBusy} onClick={() => (track('wizard_act2_skipped'), setAct(actAfterConnect({ hasRealSources: hasReal })))}>
                    {t('act2.later')}
                  </button>
                  <button type="button" className={s.ghost} disabled={formBusy} onClick={() => (track('wizard_act2_skipped'), setAct(actAfterConnect({ hasRealSources: hasReal })))}>
                    {t('act2.next')}
                  </button>
                </footer>
              )}
            </>
          )}

          {act === 3 && (
            <>
              <div className={s.spread}>
                <header className={s.head}>
                  <h2 className={s.title}>{t('act3.title')}</h2>
                  <p className={s.sub}>{t('act3.sub')}</p>
                </header>
                <div className={s.stage}>
                  <ul className={s.whyList}>
                    {(['why1', 'why2', 'why3'] as const).map((key, index) => (
                      <li key={key}>
                        <span className={s.whyIndex} aria-hidden>{String(index + 1).padStart(2, '0')}</span>
                        <span>{t(`act3.${key}`)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className={s.limit}>{t('act3.limit')}</p>
                </div>
              </div>
              <footer className={s.foot}>
                <button type="button" className={s.skip} onClick={() => (track('wizard_act3_skipped'), setAct(4))}>
                  {t('act3.later')}
                </button>
                <button
                  type="button"
                  className={s.primary}
                  disabled={!firstSourceId}
                  onClick={() => {
                    track('wizard_act3_attach')
                    // The attach modal lives on /app/sources (it needs the connected-repo list); the
                    // wizard steps aside (dismiss, not complete) and the SetupPill carries the rest.
                    finish('code_attach', `/app/sources?attach=${firstSourceId ?? ''}`)
                  }}
                >
                  {t('act3.attach')}
                </button>
              </footer>
            </>
          )}

          {act === 4 && variant === 'extract' && (
            <WizardExtraction key={firstSourceId} id={firstSourceId!} name={props.realSources[0]?.name ?? ''}
              request={io.extract} onBusyChange={setExtractBusy} onSkip={() => finish('act4_skipped')}
              onAccepted={() => finish('extract_started')} />
          )}

          {act === 4 && variant === 'sample' && (
            <>
              <div className={s.spread}>
                <header className={s.head}>
                  <h2 className={s.title}>{t('act4.titleSample')}</h2>
                  <p className={s.sub}>{t('act4.subSample')}</p>
                </header>
                <div className={s.stage}>
                  <div className={s.sampleGrid}>
                    {props.sampleSpecs.map((spec, i) => (
                      <div key={i} className={i === props.sampleSpecs.length - 1 ? s.sampleWide : s.sampleCell}>
                        <WidgetRenderer spec={spec} menu={null} fill />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <footer className={s.foot}>
                <button type="button" className={s.skip} onClick={() => finish('browse')}>
                  {t('act4.browse')}
                </button>
                <button type="button" className={s.ghost} onClick={() => finish('sample_connect', integrations.supabaseConnect ? '/app/sources?connect=supabase' : '/app/sources?connect=postgres')}>
                  {t('act4.connect')}
                </button>
              </footer>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ArrowIcon() {
  return (
    <svg className={s.connectArrow} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
