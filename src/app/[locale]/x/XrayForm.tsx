'use client'

import { useState, type FormEvent } from 'react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'

import { useRouter } from '@/i18n/navigation'
import { parseRepoInput } from '@/lib/xray/repo-ref'
import s from './XrayForm.module.css'

type ErrorCode =
  | 'invalid_repo'
  | 'not_found'
  | 'too_large'
  | 'empty'
  | 'rate_limited'
  | 'daily_budget'
  | 'busy'
  | 'github_limited'
  | 'github_unavailable'
  | 'unavailable'
  | 'network'

const KNOWN: ReadonlySet<string> = new Set<ErrorCode>([
  'invalid_repo', 'not_found', 'too_large', 'empty', 'rate_limited', 'daily_budget', 'busy',
  'github_limited', 'github_unavailable', 'unavailable', 'network',
])

interface Stale {
  path: string
  repo: string
  sha: string | null
  at: string | null
}

const PRIVATE_HREF = '/login?next=%2Fapp%2Fsettings%2Fintegrations'

/**
 * The one input of /x: a GitHub repo. Validates with the same grammar the API uses, then POSTs.
 * Every non-error answer navigates to the repo's page, which renders the scan or the report —
 * the form never holds scan state itself. An older report of the same repo is offered first
 * (free) with an explicit "Rescan latest".
 */
export default function XrayForm({
  examples = [],
  initialRepo = '',
  inputId = 'xray-repo',
  compact = false,
  labelHidden = false,
}: {
  examples?: string[]
  initialRepo?: string
  inputId?: string
  compact?: boolean
  /** keep the label for screen readers but not on screen (the hero's layout) */
  labelHidden?: boolean
}) {
  const t = useTranslations('xray.form')
  const format = useFormatter()
  const locale = useLocale()
  const router = useRouter()
  const [value, setValue] = useState(initialRepo)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ code: ErrorCode; repo: string } | null>(null)
  const [stale, setStale] = useState<Stale | null>(null)

  async function start(raw: string, rescan = false) {
    const ref = parseRepoInput(raw)
    setStale(null)
    if (!ref) {
      setError({ code: 'invalid_repo', repo: raw })
      return
    }
    const repoLabel = `${ref.owner}/${ref.repo}`
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/xray', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: repoLabel, locale, rescan }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.ok && data.mode === 'stale' && typeof data.path === 'string') {
        setStale({
          path: data.path,
          repo: repoLabel,
          sha: typeof data.scannedSha === 'string' ? data.scannedSha.slice(0, 7) : null,
          at: typeof data.scannedAt === 'string' ? data.scannedAt : null,
        })
        setPending(false)
        return
      }
      if (res.ok && typeof data.path === 'string') {
        router.push(data.path)
        return
      }
      const code = typeof data.error === 'string' && KNOWN.has(data.error) ? (data.error as ErrorCode) : 'unavailable'
      setError({ code, repo: repoLabel })
    } catch {
      setError({ code: 'network', repo: repoLabel })
    }
    setPending(false)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!pending) void start(value)
  }

  const when = stale?.at ? format.relativeTime(new Date(stale.at), new Date()) : ''

  return (
    <div className={compact ? `${s.root} ${s.compact}` : s.root}>
      <form className={s.form} onSubmit={onSubmit} noValidate>
        {!compact && (
          <label htmlFor={inputId} className={labelHidden ? s.srOnly : s.label}>
            {t('label')}
          </label>
        )}
        <div className={s.row}>
          <div className={s.field} data-invalid={error?.code === 'invalid_repo' || undefined}>
            <span className={s.prefix} aria-hidden>
              {t('prefix')}
            </span>
            <input
              id={inputId}
              className={s.input}
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={t('placeholder')}
              value={value}
              aria-label={compact ? t('label') : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <button type="submit" className={s.submit} disabled={pending}>
            {pending ? t('submitting') : t('submit')}
          </button>
        </div>
      </form>

      {error && (
        <p id={`${inputId}-error`} className={s.error} role="alert">
          {t(`errors.${error.code}`, { repo: error.repo, ahead: 0 })}
          {error.code === 'not_found' && (
            <>
              {' '}
              <a className={s.errorLink} href={PRIVATE_HREF}>
                {t('privateHint')}
              </a>
            </>
          )}
        </p>
      )}

      {stale && (
        <div className={s.stale} role="status">
          <p className={s.staleTitle}>{t('stale.title', { repo: stale.repo, when })}</p>
          {stale.sha && <p className={s.staleBody}>{t('stale.body', { sha: stale.sha })}</p>}
          <div className={s.staleActions}>
            <button type="button" className={s.primary} onClick={() => router.push(stale.path)}>
              {t('stale.view')}
            </button>
            <button type="button" className={s.secondary} disabled={pending} onClick={() => void start(stale.repo, true)}>
              {t('stale.rescan')}
            </button>
          </div>
        </div>
      )}

      {examples.length > 0 && !compact && (
        <div className={s.examples}>
          <span className={s.examplesLabel}>{t('examples')}</span>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              className={s.example}
              disabled={pending}
              onClick={() => {
                setValue(example)
                void start(example)
              }}
            >
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
