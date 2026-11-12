'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { ProjectEnvironment, SupabaseProjectChoice } from '@/lib/data-sources/supabase-projects'
import s from './setup.module.css'

const CheckIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
)

export interface ProjectPickerViewProps {
  projects: SupabaseProjectChoice[]
  canProvision: boolean
  needsReconnect: boolean
  selected: Set<string>
  submitting: Set<string>
  error: string | null
  /**
   * How the request notice reads. A plan cap is not a failure — it explains itself as a warning;
   * everything else is an error. Defaults to 'error'.
   */
  errorTone?: 'error' | 'warning'
  onToggle: (ref: string) => void
  onProvision: (refs: string[]) => void
}

/** The connect stage's card head: step number + stage name, sans title, muted description. */
function CardHead({ title, lede, hint }: { title: string; lede: string; hint?: string }) {
  const t = useTranslations('appSetup')
  return (
    <div className={s.cardHead}>
      <p className={s.eyebrow}>
        <span className={s.stepNo}>01</span>
        {t('stage.connect')}
      </p>
      <h2 className={s.cardTitle}>{title}</h2>
      <p className={s.cardLede}>{lede}</p>
      {hint && <p className={s.cardHint}>{hint}</p>}
    </div>
  )
}

/** Presentation only; provisioning and live refresh remain in ProjectPicker. */
export function ProjectPickerView({ projects, canProvision, needsReconnect, selected, submitting, error, errorTone = 'error', onToggle, onProvision }: ProjectPickerViewProps) {
  const t = useTranslations('appSetup.projects')
  // A dead grant outranks an empty list: the list is empty BECAUSE the grant is dead, and the
  // only useful action is to re-authorize.
  if (needsReconnect) {
    return (
      <section className={s.card} data-kind="picker">
        <CardHead title={t('reconnectTitle')} lede={t('reconnectBody')} />
        <div className={s.foot}>
          <div className={s.actions}>
            <Link className="dx-btn" href="/api/connect-supabase/authorize?returnTo=%2Fapp%2Fsetup">
              {t('reconnectCta')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (projects.length === 0) {
    return (
      <section className={s.card} data-kind="picker">
        <CardHead title={t('title')} lede={t('empty')} />
      </section>
    )
  }

  const choosable = projects.filter((p) => p.bootstrappable && p.state === 'none')
  const pending = new Set([...selected].filter((r) => choosable.some((p) => p.ref === r)))

  return (
    <section className={s.card} data-kind="picker">
      <CardHead
        title={t('title')}
        lede={t('lede')}
        hint={projects.some((project) => project.env !== 'unknown') ? t('environmentHint') : undefined}
      />

      <ul className={`${s.rows} ${s.projectList}`}>
        {projects.map((p) => {
          const busy = submitting.has(p.ref) || p.state === 'pending'
          const selectable = canProvision && p.bootstrappable && p.state === 'none' && !busy
          const checked = selectable ? pending.has(p.ref) : p.state === 'active'
          return (
            <li key={p.ref} className={s.project} data-state={busy ? 'pending' : p.state} data-selected={selectable && checked ? 'true' : undefined}>
              <label className={s.projectMain}>
                <span className={s.check}>
                  <input
                    type="checkbox"
                    className={s.checkInput}
                    checked={checked}
                    disabled={!selectable}
                    onChange={() => onToggle(p.ref)}
                    aria-label={p.name}
                  />
                  <span className={s.checkIcon} aria-hidden><CheckIcon /></span>
                </span>
                <span className={s.projectText}>
                  <span className={s.projectName}>
                    <span className={s.projectNameText}>{p.name}</span>
                    <EnvBadge env={p.env} label={t(`env.${p.env}`)} title={t('envGuess')} />
                  </span>
                  <span className={s.projectMeta}>
                    <code className={s.projectRef}>{p.ref}</code>
                    <span className={s.projectRegion}>{p.region}</span>
                  </span>
                  {!p.bootstrappable && <span className={`dx-badge dx-badge-warning ${s.wrapBadge}`}>{t('paused')}</span>}
                </span>
                {(busy || p.state !== 'none') && (
                  <span className={`dx-badge ${stateBadge(busy ? 'pending' : p.state)} ${s.projectState}`} data-state={busy ? 'pending' : p.state}>
                    {busy && <span className={s.stateDot} aria-hidden />}
                    {busy ? t('state.pending') : t(`state.${p.state}`)}
                  </span>
                )}
              </label>

              {(busy || p.state === 'active' || p.state === 'error') && (
                <ul className={s.provStages}>
                  <Stage on={p.stages.authorized} label={t('stage.authorized')} />
                  <Stage on={p.stages.roleCreated} label={t('stage.roleCreated')} />
                  <Stage on={p.stages.schemaScanned} label={t('stage.schemaScanned')} />
                </ul>
              )}

              {p.state === 'error' && !busy && (
                <div className={s.projectError} role="alert">
                  <span>{t(`error.${p.errorCode ?? 'generic'}` as 'error.generic')}</span>
                  {canProvision && (
                    <button type="button" className={`dx-btn-ghost dx-btn-sm ${s.retry}`} onClick={() => onProvision([p.ref])}>
                      {t('retry')}
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {error && <p className={`dx-announce ${s.notice}`} data-kind={errorTone} data-tone={errorTone === 'warning' ? 'warning' : 'negative'} role="alert">{error}</p>}

      {canProvision && choosable.length > 0 && (
        <div className={s.foot}>
          <div className={s.actions}>
            <button
              type="button"
              className="dx-btn"
              disabled={pending.size === 0 || submitting.size > 0}
              onClick={() => onProvision([...pending])}
            >
              {submitting.size > 0
                ? t('provisioning')
                : pending.size > 1
                  ? t('ctaMany', { count: pending.size })
                  : t('cta')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

const stateBadge = (state: string) =>
  state === 'active' ? 'dx-badge-success' : state === 'error' ? 'dx-badge-error' : state === 'pending' ? 'dx-badge-clay' : ''

function EnvBadge({ env, label, title }: { env: ProjectEnvironment; label: string; title: string }) {
  if (env === 'unknown') return null
  return (
    <span className="dx-badge" data-env={env} title={title}>
      {label}
    </span>
  )
}

function Stage({ on, label }: { on: boolean; label: string }) {
  return (
    <li className={s.stageRow} data-on={on}>
      <span className={s.stageIcon} aria-hidden>{on ? <CheckIcon size={11} /> : null}</span>
      {label}
    </li>
  )
}
