'use client'

import Link from 'next/link'
import { useEffect, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { ACTIVATION_MIN_KPIS, ACTIVATION_MIN_MONITORS, ACTIVATION_STEPS, REQUIRED_ACTIVATION_STEPS, isOptionalStep, type ActivationStep } from '@/lib/activation/logic'
import type { SupabaseProjectChoice } from '@/lib/data-sources/supabase-projects'
import { track } from '@/utils/analytics'
import type { BootstrapMetric, BootstrapPhase, PhaseState } from '@/lib/bootstrap/events'
import { ProjectPicker } from './ProjectPicker'
import { ScanProgress } from './ScanProgress'
import { SlackStep } from './SlackStep'
import { useIntegrations } from '@/components/integrations/IntegrationsContext'
import s from './setup.module.css'

/* ============================================================
   /app/setup — the Golden Path, in the app design system.

   Serif page title (progress on the same row), a quiet segmented
   rail of four stages (01 Connect · 02 Understand · 03 Monitor ·
   04 Notify), then ONE white card for the stage in hand: a small
   step label, a sans 18px/500 title and a muted description over
   hairline-divided rows (the stage's steps, the project list, the
   scan, the Slack controls), with the primary action bottom right.
   Every piece is derived from org activation state — nothing here
   is a wizard cursor.

   This route is the "details" destination of the home checklist
   (app/overview/SetupChecklist), not a gate: the home never sends
   anyone here to get unblocked. OPTIONAL steps (a repo, a chat alert
   channel) can never be `nextStep`, so they get their own recommended
   card below the step in hand — otherwise they would be unreachable.
   ============================================================ */

type Stage = 'connect' | 'understand' | 'monitor' | 'notify'

const STAGE_OF: Record<ActivationStep, Stage> = {
  db_connected: 'connect',
  repo_attached: 'connect',
  understanding_generated: 'understand',
  kpis_extracted: 'understand',
  kpis_approved: 'monitor',
  monitors_active: 'monitor',
  notifications_configured: 'notify',
}
const STAGES: Stage[] = ['connect', 'understand', 'monitor', 'notify']
const pad = (n: number) => String(n).padStart(2, '0')

export interface SetupClientProps {
  orgId: string
  steps: Record<ActivationStep, boolean>
  /** First incomplete REQUIRED step — an optional step is never handed over as "next". */
  nextStep: ActivationStep | null
  /** Incomplete OPTIONAL steps; offered as recommendations, never blocking. */
  suggestions: ActivationStep[]
  completed: boolean
  firstSourceId: string | null
  firstSourceName: string | null
  repoName: string | null
  slackChannel: string | null
  kpisAccepted: number
  monitorsEnabled: number
  /** Server-rendered scan progress for the first real source (null when there is no source yet). */
  scanStatus: {
    phases: Record<BootstrapPhase, PhaseState>
    counts: Record<BootstrapMetric, number | null>
    items: Record<'entities' | 'rules' | 'kpis', string[]>
    error: string | null
    active: boolean
    resumeFrom: BootstrapPhase | null
  } | null
  /** A repo is attached to the first real source — the scan can read code, not just schema. */
  hasRepo: boolean
  /** Effective per-plan check interval, in seconds (already floored to the cron period). */
  intervalSec: number
  /** Projects on the org's Supabase connection (empty unless the picker can be needed). */
  projects: SupabaseProjectChoice[]
  /** Connected to Supabase but with projects still unchosen — the picker takes over the step. */
  showPicker: boolean
  /** The stored OAuth grant is dead; the picker shows a re-authorize CTA instead of a list. */
  needsReconnect: boolean
  /** owner/admin: may mint a read-only role and set the alert channel. */
  canConfigure: boolean
  slackAppConfigured: boolean
  slackConnected: boolean
  slackChannels: Array<{ id: string; name: string }>
  selectedSlackChannel: string | null
}

const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
)
const Arrow = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * The four stages as a quiet segmented rail: the stage in hand raised, a check once done.
 *
 * "Done" must mean the work happened. A stage that carries required steps is done once THOSE
 * are done (an unattached repo never holds "01 연결" open), and a stage made only of optional
 * steps — "04 알림" — is done only when that optional thing is actually configured. It used to
 * read ✓ from first paint because `notifications_configured` was hardcoded true.
 */
function StageRail({ steps, current }: { steps: Record<ActivationStep, boolean>; current: Stage | null }) {
  const t = useTranslations('appSetup')
  return (
    <ol className={s.rail}>
      {STAGES.map((stage, index) => {
        const inStage = ACTIVATION_STEPS.filter((k) => STAGE_OF[k] === stage)
        const required = inStage.filter((k) => !isOptionalStep(k))
        const done = (required.length > 0 ? required : inStage).every((k) => steps[k])
        const optionalOnly = required.length === 0
        const state = done ? 'done' : stage === current ? 'current' : 'todo'
        return (
          <li key={stage} className={s.railItem} data-state={state} data-optional={optionalOnly || undefined} aria-current={state === 'current' ? 'step' : undefined}>
            <span className={s.railMarker} aria-hidden>
              {done ? <CheckIcon size={12} /> : pad(index + 1)}
            </span>
            <span className={s.railName}>
              {t(`stage.${stage}`)}
              {done && <span className={s.srOnly}> · {t('done')}</span>}
              {!done && optionalOnly && <span className={s.railHint}> · {t('optional')}</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** The title row every state shares: one serif h1, an optional muted lede, meta on the right. */
function Head({ title, lede, meta }: { title: string; lede?: string; meta?: ReactNode }) {
  return (
    <header className={`dx-page-head ${s.head}`}>
      <div>
        <h1 className="dx-title">{title}</h1>
        {lede && <p className="dx-sub">{lede}</p>}
      </div>
      {meta != null && <div className="dx-head-actions">{meta}</div>}
    </header>
  )
}

/** A stage card's head: step number + stage name, sans title, muted description. */
function CardHead({ stage, title, lede }: { stage: Stage; title: string; lede?: string }) {
  const t = useTranslations('appSetup')
  return (
    <div className={s.cardHead}>
      <p className={s.eyebrow}>
        <span className={s.stepNo}>{pad(STAGES.indexOf(stage) + 1)}</span>
        {t(`stage.${stage}`)}
      </p>
      <h2 className={s.cardTitle}>{title}</h2>
      {lede && <p className={s.cardLede}>{lede}</p>}
    </div>
  )
}

/**
 * The Golden Path, driven ENTIRELY by org activation state — there is no wizard cursor to lose,
 * so any OAuth round-trip or tab close resumes on the right step. Leaving marks nothing: the only
 * thing that advances this screen is the product state actually changing.
 */
export function SetupClient(props: SetupClientProps) {
  const t = useTranslations('appSetup')
  const integrations = useIntegrations()
  // Attaching code needs the GitHub App; without it the suggestion would lead nowhere.
  const suggestions = props.suggestions.filter((step) => integrations.github || step !== 'repo_attached')
  const { steps, nextStep, completed, firstSourceId, intervalSec } = props

  // Funnel: one `setup_started` per tab, and a `setup_step_viewed` whenever the step advances.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem('supalens.setup.started')) {
        sessionStorage.setItem('supalens.setup.started', '1')
        track('setup_started', { org_id: props.orgId })
      }
    } catch {
      track('setup_started', { org_id: props.orgId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!nextStep) return
    track('setup_step_viewed', {
      step: nextStep,
      org_id: props.orgId,
      ...(firstSourceId ? { source_id: firstSourceId } : {}),
    })
  }, [nextStep, props.orgId, firstSourceId])

  useEffect(() => {
    if (!completed) return
    try {
      if (sessionStorage.getItem('supalens.setup.completed')) return
      sessionStorage.setItem('supalens.setup.completed', '1')
    } catch {
      /* sessionStorage unavailable — fire anyway */
    }
    track('setup_completed', {
      org_id: props.orgId,
      kpi_count: props.kpisAccepted,
      monitor_count: props.monitorsEnabled,
    })
  }, [completed, props.orgId, props.kpisAccepted, props.monitorsEnabled])

  const picker = props.showPicker ? (
    <ProjectPicker
      initialProjects={props.projects}
      canProvision={props.canConfigure}
      initialNeedsReconnect={props.needsReconnect}
    />
  ) : null

  if (completed) {
    const nextMin = Math.round(intervalSec / 60)
    // Email delivery always exists, so an alert channel is a recommendation, not a gate: the
    // flow completes without one. Slack is a real remaining choice, so it is offered HERE —
    // otherwise the channel picker and the test send would be unreachable from setup.
    const offerSlack = props.slackAppConfigured && !props.slackChannel
    return (
      <div className={s.flow}>
        <Head title={t('complete.title')} />
        <StageRail steps={steps} current={null} />
        {/* Still shown when activated: coming back to add another project is a normal visit. */}
        {picker}
        <section className={s.card} data-kind="summary">
          <div className={s.figures}>
            <p className={s.figure}>
              <span className={s.figureMark} aria-hidden><CheckIcon size={12} /></span>
              <span className={s.figureText}>{t('complete.kpis', { count: props.kpisAccepted })}</span>
            </p>
            <p className={s.figure}>
              <span className={s.figureMark} aria-hidden><CheckIcon size={12} /></span>
              <span className={s.figureText}>{t('complete.monitors', { count: props.monitorsEnabled })}</span>
            </p>
          </div>
          <dl className={s.facts}>
            <div className={s.fact}>
              <dt className={s.factLabel}>{t('complete.source')}</dt>
              <dd className={s.factValue} data-mono={props.firstSourceName ? 'true' : undefined}>{props.firstSourceName ?? '—'}</dd>
            </div>
            <div className={s.fact}>
              <dt className={s.factLabel}>{t('complete.code')}</dt>
              <dd className={s.factValue} data-mono={props.repoName ? 'true' : undefined}>{props.repoName ?? t('complete.codeNone')}</dd>
            </div>
            <div className={s.fact}>
              <dt className={s.factLabel}>{t('complete.alerts')}</dt>
              <dd className={s.factValue}>{props.slackChannel ?? t(integrations.email ? 'complete.alertsEmail' : 'complete.alertsNone')}</dd>
            </div>
          </dl>
          <div className={s.foot}>
            <p className={s.footNote}>
              {nextMin >= 90 ? t('complete.nextHours', { hours: Math.round(nextMin / 60) }) : t('complete.next', { minutes: nextMin })}
            </p>
            <div className={s.actions}>
              <Link href="/app/monitors" className="dx-btn">
                {t('complete.openMonitoring')}
              </Link>
              <Link href="/app/ask" className="dx-btn-ghost">
                {t('complete.ask')}
              </Link>
            </div>
          </div>
        </section>
        {offerSlack && (
          <SlackStep
            standalone
            slackAppConfigured={props.slackAppConfigured}
            slackConnected={props.slackConnected}
            channels={props.slackChannels}
            selectedChannel={props.selectedSlackChannel}
            canConfigure={props.canConfigure}
          />
        )}
      </div>
    )
  }

  const currentStage: Stage = nextStep ? STAGE_OF[nextStep] : 'monitor'
  // Progress counts the REQUIRED steps only — the figure has to be reachable.
  const doneCount = REQUIRED_ACTIVATION_STEPS.filter((k) => steps[k]).length
  const scanStep = nextStep === 'understanding_generated' || nextStep === 'kpis_extracted'
  // The picker IS the connect step's action once the account is authorized — a second card
  // repeating "connect a database" beside it would offer the same thing twice.
  const pickerOwnsStep = props.showPicker && nextStep === 'db_connected'

  function badgeFor(step: ActivationStep) {
    if (steps[step]) return t('done')
    if (isOptionalStep(step)) return t('optional')
    if (step === 'kpis_approved') return t('step.kpis_approved.progress', { done: props.kpisAccepted, need: ACTIVATION_MIN_KPIS })
    if (step === 'monitors_active') return t('step.monitors_active.progress', { done: props.monitorsEnabled, need: ACTIVATION_MIN_MONITORS })
    return null
  }

  function ledeFor(step: ActivationStep) {
    if (step === 'kpis_approved') return t('step.kpis_approved.body', { need: ACTIVATION_MIN_KPIS })
    if (step === 'monitors_active') return t('step.monitors_active.body', { need: ACTIVATION_MIN_MONITORS })
    if (step === 'db_connected' && !integrations.supabaseConnect) return t('step.db_connected.directBody')
    if (step === 'notifications_configured' && !integrations.slack) return t('step.notifications_configured.webhookBody')
    return t(`step.${step}.body`)
  }

  /** The steps that make up the stage in hand, as hairline-divided rows. */
  function stageRows(stage: Stage) {
    return (
      <ul className={s.rows}>
        {ACTIVATION_STEPS.filter((k) => STAGE_OF[k] === stage).map((step) => {
          const done = steps[step]
          const current = nextStep === step
          const badge = badgeFor(step)
          return (
            <li key={step} className={s.stepRow} data-state={done ? 'done' : current ? 'current' : 'todo'} aria-current={current ? 'step' : undefined}>
              <span className={s.stepMarker} aria-hidden>{done ? <CheckIcon size={11} /> : null}</span>
              <span className={s.stepRowTitle}>{t(`step.${step}.title`)}</span>
              {badge && <span className={done ? 'dx-badge dx-badge-success' : 'dx-badge'}>{badge}</span>}
            </li>
          )
        })}
      </ul>
    )
  }

  function foot(actions: ReactNode, note?: ReactNode) {
    return (
      <div className={s.foot}>
        {note ? <p className={s.footNote}>{note}</p> : null}
        <div className={s.actions}>{actions}</div>
      </div>
    )
  }

  function bodyFor(step: ActivationStep) {
    switch (step) {
      case 'db_connected':
        return (
          <>
            {stageRows('connect')}
            {foot(
              <>
                {integrations.supabaseConnect ? (
                  <>
                    <Link href="/api/connect-supabase/authorize?returnTo=/app/setup" className="dx-btn">
                      {t('step.db_connected.cta')}
                    </Link>
                    <Link href="/app/sources" className="dx-btn-ghost">
                      {t('step.db_connected.alt')}
                    </Link>
                  </>
                ) : (
                  <Link href="/app/sources?connect=postgres" className="dx-btn">
                    {t('step.db_connected.directCta')}
                  </Link>
                )}
              </>,
            )}
          </>
        )
      case 'understanding_generated':
      case 'kpis_extracted':
        // One job, not two: the scan reads the schema, derives the rules and proposes the KPIs.
        // It resumes from whichever half is unfinished, so both steps render the same component.
        return firstSourceId ? (
          <ScanProgress
            dataSourceId={firstSourceId}
            orgId={props.orgId}
            hasRepo={props.hasRepo}
            initialStatus={props.scanStatus}
          />
        ) : (
          <>
            {stageRows('understand')}
            {foot(
              <Link href="/app/sources" className="dx-btn">
                {t('step.kpis_extracted.cta')}
              </Link>,
            )}
          </>
        )
      case 'kpis_approved':
      case 'monitors_active':
        return (
          <>
            {stageRows('monitor')}
            {foot(
              <Link href={firstSourceId ? `/app/sources/${firstSourceId}/kpis` : '/app/sources'} className="dx-btn">
                {t(`step.${step}.cta`)}
              </Link>,
            )}
          </>
        )
      // `repo_attached` / `notifications_configured` are OPTIONAL: they never arrive here as
      // `nextStep`. They are offered by the recommendations card below instead.
      default:
        return null
    }
  }

  /** Where each recommendation is actually done (nothing here is on this page's critical path). */
  const suggestionHref: Record<string, string> = {
    repo_attached: firstSourceId ? `/app/sources?attach=${firstSourceId}` : '/app/sources',
    notifications_configured: '/app/settings/notifications',
  }

  // With a source to scan, the scan card carries its own lede (it knows whether code is attached).
  const scanWithSource = scanStep && !!firstSourceId

  return (
    <div className={s.flow}>
      <Head
        title={t('title')}
        lede={t('subtitle')}
        meta={<span className="dx-badge">{t('progress', { done: doneCount, total: REQUIRED_ACTIVATION_STEPS.length })}</span>}
      />
      <StageRail steps={steps} current={nextStep ? currentStage : null} />

      {picker}

      {nextStep && !pickerOwnsStep && (
        <section className={s.card} data-stage={currentStage}>
          <CardHead
            stage={currentStage}
            title={scanWithSource ? t('scan.title') : t(`step.${nextStep}.title`)}
            lede={scanWithSource ? undefined : ledeFor(nextStep)}
          />
          {bodyFor(nextStep)}
        </section>
      )}

      {suggestions.length > 0 && (
        <section className={s.card} data-kind="suggestions">
          <div className={s.cardHead}>
            <p className={s.eyebrow}>{t('suggestions.title')}</p>
            <p className={s.cardLede}>{t('suggestions.lede')}</p>
          </div>
          <ul className={s.rows}>
            {suggestions.map((step) => (
              <li key={step} className={s.stepRow} data-state="todo">
                <span className={s.stepMarker} aria-hidden />
                <span className={s.stepRowTitle}>{t(`step.${step}.title`)}</span>
                <Link href={suggestionHref[step] ?? '/app/sources'} className="dx-btn-ghost dx-btn-sm">
                  {t(step === 'notifications_configured' && !integrations.slack ? 'step.notifications_configured.webhookCta' : `step.${step}.cta`)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={s.exit}>
        <Link href="/app/overview" className="dx-text-link">
          {t('browse')} <Arrow />
        </Link>
      </div>
    </div>
  )
}
