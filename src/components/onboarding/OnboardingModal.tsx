'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Check, CircleDot, ShieldCheck, X } from 'lucide-react'

import LogoMark from '@/components/brand/LogoMark'
import DatabaseLogo, { DATABASES } from '@/components/brand/DatabaseLogo'
import { Select } from '@/components/ui/Select'
import { ACTIVATION_MIN_KPIS, ACTIVATION_MIN_MONITORS } from '@/lib/activation/logic'
import { onboardingConnectHref } from '@/lib/onboarding/logic'
import s from './OnboardingModal.module.css'

/* ============================================================
   Onboarding modal — the Golden Path (/app/setup) as one dialog,
   drawn in the editorial system of the home page (editorial design system):
   pale lavender rail with the four stages (01 Connect · 02
   Understand · 03 Monitor · 04 Notify), a white content column
   with a mono stage tag, a regular-weight serif title, a muted
   lede and the stage's material in hairline-divided panels, and
   a footer with the quiet skip and the ink primary.

   Two modes. `preview` (the default) walks every stage with the
   SAMPLE_* data below and no IO — the design review surface.
   `live` is what a first entry to /app shows when nothing is
   connected (OnboardingModalGate): welcome → pick a database →
   that database's REAL connect flow (Supabase OAuth resuming on
   /app/setup, the others' forms on /app/sources). The rail still
   shows all four stages as the path ahead, but no sample screen is
   ever presented as the user's own data.
   ============================================================ */

type Screen = 'welcome' | 'connect' | 'projects' | 'understand' | 'monitor' | 'notify' | 'done'
type Stage = 'connect' | 'understand' | 'monitor' | 'notify'

const SCREENS: Screen[] = ['welcome', 'connect', 'projects', 'understand', 'monitor', 'notify', 'done']
const LIVE_SCREENS: Screen[] = ['welcome', 'connect']
const STAGES: Stage[] = ['connect', 'understand', 'monitor', 'notify']
const STAGE_OF: Partial<Record<Screen, Stage>> = {
  connect: 'connect',
  projects: 'connect',
  understand: 'understand',
  monitor: 'monitor',
  notify: 'notify',
}
const pad = (n: number) => String(n).padStart(2, '0')

const SAMPLE_PROJECTS = [
  { id: 'prod', name: 'dailycart-prod', region: 'ap-northeast-2', env: 'production' as const },
  { id: 'staging', name: 'dailycart-staging', region: 'ap-northeast-2', env: 'staging' as const },
  { id: 'site', name: 'marketing-site', region: 'us-east-1', env: 'unknown' as const, paused: true },
]
const SAMPLE_REPO = 'dailycart/web'
const SAMPLE_ENTITIES = ['orders', 'payments', 'subscriptions', 'entitlements', 'customers', 'refunds']
const SAMPLE_KPIS = [
  { key: 'revenue', definition: "sum(orders.amount) where status = 'paid'", recommended: true },
  { key: 'paymentFailure', definition: 'failed ÷ attempted · payments', recommended: true },
  { key: 'entitlement', definition: 'paid orders without an active entitlement', recommended: true },
  { key: 'conversion', definition: 'trial → paid within 14 days', recommended: false },
  { key: 'activeSubs', definition: "count(subscriptions) where status = 'active'", recommended: false },
] as const
const SAMPLE_CHANNELS = ['business-alerts', 'alerts', 'growth']
const SAMPLE_INTERVAL_MIN = 5

export interface OnboardingModalProps {
  /** Starts open. */
  defaultOpen?: boolean
  /** next/font variable classes of the editorial system — the dialog is portaled out of `main.ed`. */
  fontClassName?: string
  /** `preview` = the sample walkthrough; `live` = a real first entry that hands off to connecting. */
  mode?: 'preview' | 'live'
  /** Every exit of the dialog: close, skip, or handing off to the connect flow. */
  onExit?: () => void
}

export default function OnboardingModal({ defaultOpen = true, fontClassName = '', mode = 'preview', onExit }: OnboardingModalProps) {
  const live = mode === 'live'
  const screens = live ? LIVE_SCREENS : SCREENS
  const router = useRouter()
  const t = useTranslations('onboardingModal')
  const setup = useTranslations('appSetup')
  const product = useTranslations('globalProduct')

  const [open, setOpen] = useState(defaultOpen)
  const [index, setIndex] = useState(0)
  const [source, setSource] = useState<(typeof DATABASES)[number]['key']>('supabase')
  const [project, setProject] = useState('prod')
  const [accepted, setAccepted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SAMPLE_KPIS.map((k) => [k.key, k.recommended])),
  )
  const [alerting, setAlerting] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SAMPLE_KPIS.map((k) => [k.key, k.recommended])),
  )
  const [destination, setDestination] = useState<'slack' | 'email'>('slack')
  const [channel, setChannel] = useState(SAMPLE_CHANNELS[0])
  const headingRef = useRef<HTMLHeadingElement>(null)

  const screen = screens[index]
  const stage = STAGE_OF[screen] ?? null
  const stageIndex = screen === 'done' ? STAGES.length : stage ? STAGES.indexOf(stage) : -1
  const acceptedCount = SAMPLE_KPIS.filter((k) => accepted[k.key]).length
  const monitorCount = SAMPLE_KPIS.filter((k) => accepted[k.key] && alerting[k.key]).length

  // Each screen starts at its title for keyboard and screen-reader users.
  useEffect(() => {
    if (open) headingRef.current?.focus({ preventScroll: true })
  }, [index, open])

  const go = (next: number) => setIndex(Math.max(0, Math.min(screens.length - 1, next)))
  const restart = () => {
    setIndex(0)
    setOpen(false)
    onExit?.()
  }
  // live: leave for the chosen database's real connect flow (OAuth is a full-page redirect)
  const connect = () => {
    const href = onboardingConnectHref(source)
    restart()
    if (href.startsWith('/api/')) window.location.assign(href)
    else router.push(href)
  }
  const sourceName = DATABASES.find((db) => db.key === source)?.name ?? ''

  const content: Record<Screen, { tag: string; title: string; lede?: string; body: ReactNode; note?: string; primary: string; primaryDisabled?: boolean }> = {
    welcome: {
      tag: t('welcome.tag'),
      title: setup('title'),
      lede: setup('subtitle'),
      primary: t('start'),
      body: (
        <ul className={s.points}>
          {(t.raw('welcome.points') as { title: string; body: string }[]).map((point, i) => (
            <li key={point.title} className={s.point}>
              <span className={s.pointIndex}>{pad(i + 1)}</span>
              <h3 className={s.pointTitle}>{point.title}</h3>
              <p className={s.pointBody}>{point.body}</p>
            </li>
          ))}
        </ul>
      ),
    },
    connect: {
      tag: stageTag(0, setup('stage.connect')),
      title: setup('step.db_connected.title'),
      lede: setup('step.db_connected.body'),
      primary: live ? t('connectCta', { name: sourceName }) : setup('step.db_connected.cta'),
      body: <SourceList value={source} onChange={setSource} />,
    },
    projects: {
      tag: stageTag(0, setup('stage.connect')),
      title: setup('projects.title'),
      lede: setup('projects.lede'),
      primary: setup('projects.cta'),
      body: <ProjectList value={project} onChange={setProject} />,
    },
    understand: {
      tag: stageTag(1, setup('stage.understand')),
      title: setup('scan.title'),
      lede: setup('scan.body'),
      primary: setup('scan.review'),
      body: <ScanPanel />,
    },
    monitor: {
      tag: stageTag(2, setup('stage.monitor')),
      title: setup('step.kpis_approved.title'),
      lede: setup('step.kpis_approved.body', { need: ACTIVATION_MIN_KPIS }),
      primary: t('next'),
      primaryDisabled: acceptedCount < ACTIVATION_MIN_KPIS,
      body: (
        <KpiList
          accepted={accepted}
          alerting={alerting}
          onAccept={(key, value) => setAccepted((prev) => ({ ...prev, [key]: value }))}
          onAlert={(key, value) => setAlerting((prev) => ({ ...prev, [key]: value }))}
          acceptedCount={acceptedCount}
          monitorCount={monitorCount}
        />
      ),
    },
    notify: {
      tag: stageTag(3, setup('stage.notify')),
      title: setup('slack.title'),
      lede: setup('slack.lede'),
      primary: setup('slack.startWatching'),
      body: <NotifyPanel destination={destination} onDestination={setDestination} channel={channel} onChannel={setChannel} />,
    },
    done: {
      tag: setup('done'),
      title: setup('complete.title'),
      primary: setup('complete.openMonitoring'),
      body: (
        <>
        <ul className={s.doneStats}>
          <li>
            <Check size={14} strokeWidth={2.2} aria-hidden />
            {setup('complete.kpis', { count: acceptedCount })}
          </li>
          <li>
            <Check size={14} strokeWidth={2.2} aria-hidden />
            {setup('complete.monitors', { count: monitorCount })}
          </li>
        </ul>
        <dl className={s.summary}>
          <SummaryRow label={setup('complete.source')} value={<code>{SAMPLE_PROJECTS.find((p) => p.id === project)?.name}</code>} />
          <SummaryRow label={setup('complete.code')} value={<code>{SAMPLE_REPO}</code>} />
          <SummaryRow
            label={setup('complete.alerts')}
            value={destination === 'slack' ? <code># {channel}</code> : setup('complete.alertsEmail')}
          />
        </dl>
        </>
      ),
      note: setup('complete.next', { minutes: SAMPLE_INTERVAL_MIN }),
    },
  }
  const current = content[screen]

  function stageTag(i: number, name: string) {
    return `${pad(i + 1)} · ${name}`
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : restart())}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.scrim} />
        <Dialog.Content className={s.content} aria-describedby={undefined} onOpenAutoFocus={(event) => event.preventDefault()}>
          <div className={`ed ${fontClassName} ${s.sheet}`}>
            <Dialog.Title className="sr-only">{t('aria')}</Dialog.Title>

            {/* ---------- rail ---------- */}
            <aside className={s.rail}>
              <div className={s.brand}>
                <LogoMark size={18} />
                <span className={s.wordmark}>Supalens</span>
              </div>
              <p className={s.railLabel}>{t('railLabel')}</p>
              <ol className={s.stages}>
                {STAGES.map((name, i) => {
                  const state = i < stageIndex ? 'done' : i === stageIndex ? 'current' : 'todo'
                  const sub = name === 'notify' ? t('notifySub') : setup(`stageSub.${name}`)
                  return (
                    <li key={name} className={s.stage} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
                      <span className={s.marker} aria-hidden>
                        {state === 'done' ? <Check size={13} strokeWidth={2} /> : pad(i + 1)}
                      </span>
                      <span className={s.stageText}>
                        <span className={s.stageName}>
                          {setup(`stage.${name}`)}
                          {state === 'done' && <span className="sr-only"> · {setup('status.done')}</span>}
                        </span>
                        <span className={s.stageSub}>{sub}</span>
                      </span>
                    </li>
                  )
                })}
              </ol>
              <p className={s.trust}>
                <ShieldCheck size={15} aria-hidden />
                <span>{setup('actions.trust')}</span>
              </p>
            </aside>

            {/* ---------- main ---------- */}
            <div className={s.main}>
              <div className={s.top}>
                <span className={s.progress} aria-hidden>
                  {stageIndex >= 0 && stageIndex < STAGES.length ? `${pad(stageIndex + 1)} / ${pad(STAGES.length)}` : ''}
                </span>
                <span className={s.topEnd}>
                  {!live && <span className={s.previewTag}>{product('previewLabel')}</span>}
                  <Dialog.Close className={s.close} aria-label={t('close')}>
                    <X size={18} strokeWidth={1.6} aria-hidden />
                  </Dialog.Close>
                </span>
              </div>

              {/* Mobile: the rail folds into a four-segment bar. */}
              <ol className={s.segments} aria-hidden>
                {STAGES.map((name, i) => (
                  <li key={name} data-state={i < stageIndex ? 'done' : i === stageIndex ? 'current' : 'todo'} />
                ))}
              </ol>

              <div className={s.scroll} key={screen}>
                <span className={`ed-tag ed-tag--small ${s.tag}`}>{current.tag}</span>
                <h2 ref={headingRef} tabIndex={-1} className={s.title}>
                  {current.title}
                </h2>
                {current.lede && <p className={s.lede}>{current.lede}</p>}
                <div className={s.body}>{current.body}</div>
                {current.note && (
                  <p className={s.hint}>
                    <CircleDot size={14} aria-hidden />
                    {current.note}
                  </p>
                )}
              </div>

              <div className={s.footer}>
                {screen === 'done' ? (
                  <button type="button" className={s.skip} onClick={restart}>
                    {setup('complete.ask')}
                  </button>
                ) : (
                  <button type="button" className={s.skip} onClick={restart}>
                    {setup('skip')}
                  </button>
                )}
                <div className={s.actions}>
                  {index > 0 && screen !== 'done' && (
                    <button type="button" className="ed-button" onClick={() => go(index - 1)}>
                      {t('back')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ed-button ed-button--primary"
                    disabled={current.primaryDisabled}
                    onClick={() => (screen === 'done' ? restart() : live && screen === 'connect' ? connect() : go(index + 1))}
                  >
                    {current.primary}
                    <ArrowRight size={15} aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ---------------- 01 connect: source ---------------- */
function SourceList({ value, onChange }: { value: string; onChange: (key: (typeof DATABASES)[number]['key']) => void }) {
  const methods = useTranslations('connections')
  const setup = useTranslations('appSetup')
  return (
    <div className={s.panel} role="radiogroup" aria-label={setup('step.db_connected.title')}>
      {DATABASES.map((db) => (
        <label key={db.key} className={s.choice} data-selected={value === db.key}>
          <input type="radio" name="onboarding-source" value={db.key} checked={value === db.key} onChange={() => onChange(db.key)} />
          <DatabaseLogo name={db.key} size={24} className={s.choiceLogo} />
          <span className={s.choiceText}>
            <span className={s.choiceName}>
              {db.name}
              {db.key === 'supabase' && <span className="ed-tag ed-tag--small ed-tag--bloom">{setup('slack.suggested')}</span>}
            </span>
            <span className={s.choiceSub}>{methods(`methods.${db.key}`)}</span>
          </span>
          <span className={s.radio} aria-hidden />
        </label>
      ))}
    </div>
  )
}

/* ---------------- 01 connect: project + code ---------------- */
function ProjectList({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const setup = useTranslations('appSetup')
  return (
    <>
      <div className={s.panel} role="radiogroup" aria-label={setup('projects.title')}>
        {SAMPLE_PROJECTS.map((p) => (
          <label key={p.id} className={s.choice} data-selected={value === p.id} data-disabled={p.paused || undefined}>
            <input type="radio" name="onboarding-project" value={p.id} checked={value === p.id} disabled={p.paused} onChange={() => onChange(p.id)} />
            <DatabaseLogo name="supabase" size={20} className={s.choiceLogo} />
            <span className={s.choiceText}>
              <span className={s.choiceName}>
                <code className={s.code}>{p.name}</code>
                <span className={`ed-tag ed-tag--small ed-tag--neutral ${s.envTag}`} title={setup('projects.envGuess')}>
                  {setup(`projects.env.${p.env}`)}
                </span>
              </span>
              <span className={s.choiceSub}>{p.paused ? setup('projects.paused') : p.region}</span>
            </span>
            <span className={s.radio} aria-hidden />
          </label>
        ))}
      </div>
      <p className={s.hint}>{setup('projects.environmentHint')}</p>

      <div className={s.codeRow}>
        <div className={s.codeText}>
          <p className={s.codeTitle}>
            {setup('step.repo_attached.title')}
            <span className="ed-tag ed-tag--small ed-tag--neutral">{setup('optional')}</span>
          </p>
          <p className={s.choiceSub}>{setup('step.repo_attached.note')}</p>
        </div>
        <span className={s.repo}>
          <Check size={14} aria-hidden />
          <code>{SAMPLE_REPO}</code>
        </span>
      </div>
    </>
  )
}

/* ---------------- 02 understand: scan ---------------- */
function ScanPanel() {
  const setup = useTranslations('appSetup')
  const metrics = [
    { key: 'tables', value: 38 },
    { key: 'entities', value: 9 },
    { key: 'rules', value: 14 },
    { key: 'kpis', value: 5 },
  ]
  return (
    <>
      <div className={s.panel}>
        <ol className={s.phases} aria-label={setup('scan.phasesLabel')}>
          {(['schema', 'context', 'kpi'] as const).map((phase, i) => (
            <li key={phase} className={s.phase}>
              <span className={s.phaseIndex}>{pad(i + 1)}</span>
              <span className={s.phaseName}>{setup(`scan.phase.${phase}`)}</span>
              <span className={s.phaseState} data-state="done">
                <Check size={13} strokeWidth={2} aria-hidden />
                {setup('scan.phaseState.done')}
              </span>
            </li>
          ))}
        </ol>
        <dl className={s.metrics} aria-label={setup('scan.countsLabel')}>
          {metrics.map((m) => (
            <div key={m.key}>
              <dt>{setup(`scan.metric.${m.key}`)}</dt>
              <dd>{m.value}</dd>
            </div>
          ))}
        </dl>
        <div className={s.reveal}>
          <span className={s.revealLabel}>{setup('scan.reveal.entities')}</span>
          <ul className={s.chips}>
            {SAMPLE_ENTITIES.map((entity) => (
              <li key={entity} className="ed-tag ed-tag--small ed-tag--neutral ed-tag--code">
                {entity}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className={s.hint}>
        <CircleDot size={14} aria-hidden />
        {setup('scan.leaveSafe')}
      </p>
    </>
  )
}

/* ---------------- 03 monitor: KPI approval ---------------- */
function KpiList(props: {
  accepted: Record<string, boolean>
  alerting: Record<string, boolean>
  onAccept: (key: string, value: boolean) => void
  onAlert: (key: string, value: boolean) => void
  acceptedCount: number
  monitorCount: number
}) {
  const t = useTranslations('onboardingModal')
  const setup = useTranslations('appSetup')
  return (
    <>
      <div className={s.counts}>
        <span data-met={props.acceptedCount >= ACTIVATION_MIN_KPIS}>
          {setup('step.kpis_approved.progress', { done: props.acceptedCount, need: ACTIVATION_MIN_KPIS })}
        </span>
        <span data-met={props.monitorCount >= ACTIVATION_MIN_MONITORS}>
          {setup('step.monitors_active.progress', { done: props.monitorCount, need: ACTIVATION_MIN_MONITORS })}
        </span>
      </div>
      <ul className={s.panel}>
        {SAMPLE_KPIS.map((kpi) => {
          const on = !!props.accepted[kpi.key]
          const name = t(`kpis.${kpi.key}`)
          return (
            <li key={kpi.key} className={s.kpi} data-selected={on}>
              <label className={s.kpiMain}>
                <input type="checkbox" className={s.checkbox} checked={on} onChange={(e) => props.onAccept(kpi.key, e.target.checked)} />
                <span className={s.choiceText}>
                  <span className={s.choiceName}>
                    {name}
                    {kpi.recommended && <span className="ed-tag ed-tag--small ed-tag--bloom">{setup('slack.suggested')}</span>}
                  </span>
                  <code className={s.definition}>{kpi.definition}</code>
                </span>
              </label>
              <button
                type="button"
                role="switch"
                className={s.switch}
                aria-checked={on && !!props.alerting[kpi.key]}
                aria-label={`${name} · ${t('alertToggle')}`}
                disabled={!on}
                onClick={() => props.onAlert(kpi.key, !props.alerting[kpi.key])}
              >
                <span className={s.switchLabel}>{t('alertToggle')}</span>
                <span className={s.track} aria-hidden>
                  <span className={s.thumb} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className={s.hint}>{setup('actions.monitorHint')}</p>
    </>
  )
}

/* ---------------- 04 notify ---------------- */
function NotifyPanel(props: {
  destination: 'slack' | 'email'
  onDestination: (value: 'slack' | 'email') => void
  channel: string
  onChannel: (value: string) => void
}) {
  const t = useTranslations('onboardingModal')
  const setup = useTranslations('appSetup')
  const alert = useTranslations('alertDemo')
  const email = useTranslations('emailAlert')
  return (
    <div className={s.notify}>
      <div className={s.panel} role="radiogroup" aria-label={setup('slack.channelLabel')}>
        <label className={s.choice} data-selected={props.destination === 'slack'}>
          <input type="radio" name="onboarding-destination" checked={props.destination === 'slack'} onChange={() => props.onDestination('slack')} />
          <span className={s.choiceText}>
            <span className={s.choiceName}>
              {t('slackOption')}
              <span className={s.connected}>
                <Check size={13} strokeWidth={2} aria-hidden />
                {setup('actions.slackConnected')}
              </span>
            </span>
            <span className={s.choiceSub}>{setup('slack.mentionNote')}</span>
          </span>
          <span className={s.radio} aria-hidden />
        </label>
        {props.destination === 'slack' && (
          <div className={s.channel}>
            <span className={s.fieldLabel}>{setup('slack.channelLabel')}</span>
            <Select
              value={props.channel}
              onValueChange={props.onChannel}
              ariaLabel={setup('slack.channelLabel')}
              options={SAMPLE_CHANNELS.map((c) => ({ value: c, label: `# ${c}` }))}
            />
          </div>
        )}
        <label className={s.choice} data-selected={props.destination === 'email'}>
          <input type="radio" name="onboarding-destination" checked={props.destination === 'email'} onChange={() => props.onDestination('email')} />
          <span className={s.choiceText}>
            <span className={s.choiceName}>{t('emailOption')}</span>
            <span className={s.choiceSub}>{setup('step.notifications_configured.emailOnly')}</span>
          </span>
          <span className={s.radio} aria-hidden />
        </label>
      </div>

      <figure className={s.preview}>
        <figcaption className={s.previewLabel}>{setup('slack.previewTitle')}</figcaption>
        <p className={s.previewState}>
          <span className={s.dot} aria-hidden />
          {email('headingFired')}
        </p>
        <p className={s.previewName}>{setup('slack.previewName')}</p>
        <p className={s.previewFacts}>{setup('slack.previewFacts')}</p>
        <div className={s.previewCause}>
          <span className="ed-tag ed-tag--small ed-tag--bloom">{alert('likelyTag')}</span>
          <p>{setup('slack.previewCause')}</p>
        </div>
      </figure>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={s.summaryRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
