'use client'

import { useTranslations } from 'next-intl'

import { ALERT_OPS, type ConditionEval, type MonitorCondition } from '@/lib/alerts/condition'
import { OPERATOR_SYMBOL, type AlertOp } from '@/lib/alerts/evaluate'
import { Select } from '@/components/ui/Select'
import { switchStrategy } from './draft-view'
import s from './goal.module.css'

const STRATEGIES: MonitorCondition['strategy'][] = ['anomaly', 'relative', 'absolute']
const WINDOWS = [1, 7, 28] as const

/**
 * The rule's knobs. Every change produces a whole new (valid) condition, so the parent's preview —
 * chart edges, backtest count, "would alert now" — recomputes on the same render.
 */
export function ConditionControls({
  condition,
  onChange,
  current,
  disabled,
}: {
  condition: MonitorCondition
  onChange: (next: MonitorCondition) => void
  /** today's evaluation — seeds a fixed number from the usual range when switching to it */
  current: ConditionEval | null
  disabled?: boolean
}) {
  const t = useTranslations('appMonitors.goal.card')

  return (
    <div className={s.controls}>
      <div className="dx-segmented" role="group" aria-label={t('ruleLabel')}>
        {STRATEGIES.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={condition.strategy === k}
            data-active={condition.strategy === k}
            disabled={disabled}
            onClick={() => onChange(switchStrategy(condition, k, current))}
          >
            {t(`strategy.${k}`)}
          </button>
        ))}
      </div>

      {condition.strategy !== 'absolute' && (
        <div className="dx-segmented" role="group" aria-label={t('directionLabel')}>
          {(condition.strategy === 'anomaly' ? (['down', 'up', 'both'] as const) : (['down', 'up'] as const)).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={condition.direction === d}
              data-active={condition.direction === d}
              disabled={disabled}
              onClick={() => onChange({ ...condition, direction: d } as MonitorCondition)}
            >
              {t(`direction.${d}`)}
            </button>
          ))}
        </div>
      )}

      {condition.strategy === 'anomaly' && (
        <label className={s.control}>
          <span>{t('sensitivityEarly')}</span>
          <input
            type="range"
            className={s.slider}
            min={1.5}
            max={5}
            step={0.5}
            // left = a smaller σ cutoff = alerts earlier; right = only big moves
            value={condition.sensitivity}
            disabled={disabled}
            aria-label={t('sensitivity')}
            aria-valuetext={`${condition.sensitivity}σ`}
            onChange={(e) => onChange({ ...condition, sensitivity: Number(e.target.value) })}
          />
          <span>{t('sensitivityBig')}</span>
          <span className={s.basis}>{condition.sensitivity}σ</span>
        </label>
      )}

      {condition.strategy === 'relative' && (
        <>
          <label className={s.control}>
            <span>{t('pct')}</span>
            <input
              className={s.smallInput}
              inputMode="decimal"
              // committed on blur/Enter so the field can be cleared and retyped
              defaultValue={String(Math.round(condition.pct * 1000) / 10)}
              key={`pct-${condition.pct}`}
              disabled={disabled}
              aria-label={t('pct')}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v >= 1 && v <= 1000) onChange({ ...condition, pct: v / 100 })
                else e.target.value = String(Math.round(condition.pct * 1000) / 10)
              }}
            />
            <span>%</span>
          </label>
          <div className={s.control}>
            <span>{t('window')}</span>
            <Select
              size="sm"
              value={String(condition.window)}
              disabled={disabled}
              ariaLabel={t('window')}
              onValueChange={(v) => onChange({ ...condition, window: Number(v) })}
              options={(WINDOWS.includes(condition.window as 1 | 7 | 28) ? WINDOWS : [...WINDOWS, condition.window]).map((w) => ({
                value: String(w),
                label: w === 1 ? t('window1') : t('windowN', { n: w }),
              }))}
            />
          </div>
        </>
      )}

      {condition.strategy === 'absolute' && (
        <div className={s.control}>
          <span>{t('threshold')}</span>
          <Select
            size="sm"
            value={condition.operator}
            disabled={disabled}
            ariaLabel={t('operator')}
            onValueChange={(v) => onChange({ ...condition, operator: v as AlertOp })}
            options={ALERT_OPS.map((o) => ({ value: o, label: OPERATOR_SYMBOL[o] }))}
          />
          <input
            className={s.smallInput}
            inputMode="decimal"
            defaultValue={String(condition.threshold)}
            key={`threshold-${condition.threshold}`}
            disabled={disabled}
            aria-label={t('threshold')}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (e.target.value.trim() !== '' && Number.isFinite(v)) onChange({ ...condition, threshold: v })
              else e.target.value = String(condition.threshold)
            }}
          />
        </div>
      )}
    </div>
  )
}
