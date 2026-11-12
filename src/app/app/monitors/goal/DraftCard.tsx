'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import { conditionViewOf, type MonitorCondition } from '@/lib/alerts/condition'
import { conditionBasis, conditionSentence } from '@/lib/alerts/condition-label'
import type { MonitorDraft } from '@/lib/alerts/draft'
import { formatValue, setVizLocale } from '@/lib/viz/format'
import { buildDraftPreview, isIntegerSeries, readableBound } from './draft-view'
import { ConditionControls } from './ConditionControls'
import { SeriesBandChart } from './SeriesBandChart'
import s from './goal.module.css'

/**
 * The approval card: the operator's words, the evidence (their own data + how often this rule
 * would have fired), then the rule itself with its knobs. Every number here is computed from the
 * draft's sample by code (draft-view.ts) — none of it comes from the model. Nothing is created
 * until "Create monitor", which goes through the normal member-gated createAlert action.
 */
export function DraftCard({
  draft,
  sourceName,
  timezone,
  pending,
  onCreate,
  onRedraft,
  onDiscard,
}: {
  draft: MonitorDraft
  sourceName: string | null
  timezone: string
  pending: boolean
  onCreate: (args: { name: string; condition: MonitorCondition }) => void
  onRedraft: () => void
  onDiscard: () => void
}) {
  const t = useTranslations('appMonitors.goal.card')
  const tc = useTranslations('appCondition')
  const locale = useLocale()
  const [name, setName] = useState(draft.name)
  const [condition, setCondition] = useState<MonitorCondition>(draft.condition)
  // a fresh draft (redraft) resets the card to what the agent proposed
  useEffect(() => {
    setName(draft.name)
    setCondition(draft.condition)
  }, [draft])

  // the clock the in-progress day is judged against — fixed per card so the preview is stable
  const [now] = useState(() => Date.now())
  const preview = useMemo(() => buildDraftPreview(draft, condition, now, timezone), [draft, condition, now, timezone])

  setVizLocale(locale)
  const fmt = (n: number) => formatValue(n, draft.format)
  const numFmt = (n: number) => formatValue(n, draft.format ?? { kind: 'number' })
  const view = conditionViewOf({ type: 'goal', operator: 'gt', threshold: 0, sensitivity: null, condition })
  const basis = conditionBasis(view, tc)

  const current = preview?.current ?? null
  const days = preview?.points.length ?? 0
  const fires = preview?.backtest.fires ?? 0
  const noisy = fires > Math.max(3, days / 10)
  const lastDay = preview?.points[preview.points.length - 1]?.bucket ?? null

  const intSeries = preview ? isIntegerSeries(preview.points) : false
  const bound = (v: number, side: 'lower' | 'upper') => fmt(readableBound(v, side, intSeries))
  let line: string | null = null
  if (current && !current.insufficient) {
    if (current.lower != null && current.upper != null) line = t('currentRange.both', { lower: bound(current.lower, 'lower'), upper: bound(current.upper, 'upper') })
    else if (current.lower != null) line = t('currentRange.lower', { value: bound(current.lower, 'lower') })
    else if (current.upper != null) line = t('currentRange.upper', { value: bound(current.upper, 'upper') })
  }

  const chartLabel = t('chartLabel', { days, count: fires })

  return (
    <div className={s.card} data-goal-draft>
      <div className={s.cardTop}>
        <span className={s.kicker}>{t('kicker')}</span>
        <p className={s.quoted}>“{draft.goal}”</p>
        <input
          className={s.nameInput}
          value={name}
          maxLength={80}
          aria-label={t('nameLabel')}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
        />
        {sourceName && <p className={s.meta}>{t('source', { name: sourceName })}</p>}
      </div>

      {preview && (
        <SeriesBandChart points={preview.points} bands={preview.bands} firedBuckets={preview.firedBuckets} format={numFmt} bound={bound} label={chartLabel} />
      )}

      <div className={s.facts}>
        <div className={s.fact}>
          <span className={s.factLabel}>{t('factLine')}</span>
          <span className={s.factValue}>{line ?? '—'}</span>
          {current?.insufficient && <span className={s.factNote}>{t('learning')}</span>}
        </div>
        <div className={s.fact}>
          <span className={s.factLabel}>{t('factLatest')}</span>
          <span className={s.factValue} data-tone={current?.met ? 'negative' : undefined}>
            {current?.latest != null ? fmt(current.latest) : '—'}
          </span>
          <span className={s.factNote}>
            {lastDay ?? ''}
            {current?.met ? ` · ${t('wouldFireNow')}` : ''}
          </span>
        </div>
        <div className={s.fact}>
          <span className={s.factLabel}>{t('factBacktest', { days })}</span>
          <span className={s.factValue} data-tone={noisy ? 'negative' : undefined}>
            {t('backtestCount', { count: fires })}
          </span>
          {preview && preview.firedBuckets.length > 0 && (
            <span className={s.factNote}>{t('backtestDates', { dates: preview.firedBuckets.slice(-3).join(', ') })}</span>
          )}
        </div>
      </div>

      <div className={s.rule}>
        <p className={s.ruleSentence}>{conditionSentence(view, tc, fmt)}</p>
        <ConditionControls condition={condition} onChange={setCondition} current={current} disabled={pending} />
        {basis && <p className={s.basis}>{basis}</p>}
        {noisy && <p className={s.warn}>{t('noisy')}</p>}
        <p className={s.basis}>{t('cadence', { tz: timezone })}</p>
      </div>

      <p className={s.why}>
        <span className={s.whyLabel}>{t('why')}</span>
        {draft.rationale}
      </p>
      <details>
        <summary className={s.summaryToggle}>{t('sql')}</summary>
        <pre className={s.sqlBlock}>{draft.metricSql}</pre>
      </details>

      <div className={s.foot}>
        <p className={s.footHint}>{t('approveHint')}</p>
        <button type="button" className="dx-btn-ghost" disabled={pending} onClick={onDiscard}>
          {t('discard')}
        </button>
        <button type="button" className="dx-btn-ghost" disabled={pending} onClick={onRedraft}>
          {t('redraft')}
        </button>
        <button
          type="button"
          className="dx-btn"
          disabled={pending || !name.trim()}
          onClick={() => onCreate({ name: name.trim(), condition })}
        >
          {t('create')}
        </button>
      </div>
    </div>
  )
}
