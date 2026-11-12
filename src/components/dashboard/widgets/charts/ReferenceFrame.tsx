'use client'

import { useId, type ReactElement } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { formatValue } from '@/lib/viz/format'
import type { Format } from '@/lib/viz/spec'
import { INTENT_COLOR } from '../theme'
import { ChartFrame } from './ChartFrame'
import { coincidentReferences, exactReferenceValue, referenceDash, type ChartReference } from './references'
import s from './charts.module.css'

/** Labels live in flow, not at data coordinates: long/adjacent labels cannot collide.
 * A filled report cell keeps a usable plot and lets the existing keyboard-scrollable
 * widget body scroll when the complete legend needs more space. No references →
 * exactly the existing ChartFrame sizing and behavior. */
export function ReferenceFrame({ height, references, valueFormat, children }: {
  height: number | `${number}%`
  references?: ChartReference[]
  valueFormat?: Format
  children: ReactElement
}) {
  const t = useTranslations('appDashboards.widget.references')
  const locale = useLocale()
  const titleId = useId()
  if (!references?.length) return <ChartFrame height={height}>{children}</ChartFrame>

  const fill = typeof height === 'string'
  return (
    <div className={`${s.referenceFrame} ${fill ? s.referenceFrameFill : ''}`}>
      <div className={s.referencePlot} data-reference-plot style={fill ? undefined : { height }}>
        <div className={s.referenceCanvas}><ChartFrame height="100%">{children}</ChartFrame></div>
      </div>
      <section className={s.referenceLegend} aria-labelledby={titleId} data-reference-legend>
        <h4 id={titleId}>{t('title')}</h4>
        <p>{t('description')}</p>
        <ol className={s.referenceList}>
          {references.map((reference, index) => {
            const sameLevel = coincidentReferences(references, index)
            return (
              <li key={index} data-reference-entry>
                <span className={s.referenceKey}>
                  <span>{index + 1}</span>
                  <svg width="32" height="12" viewBox="0 0 32 12" aria-hidden="true"><line x1="0" y1="6" x2="32" y2="6" stroke={INTENT_COLOR[reference.intent]} strokeWidth="2" strokeDasharray={referenceDash(index)} /></svg>
                </span>
                <div className={s.referenceDefinition}>
                  <span className={s.referenceName} data-reference-name><bdi>{reference.label?.trim() ? reference.label : t('unnamed', { number: index + 1 })}</bdi></span>
                  <span className={s.referenceIntent}>{t(reference.intent)}</span>
                  {sameLevel.length > 0 && <span className={s.referenceCoincident} data-reference-coincident>{t('coincident', { numbers: sameLevel.join(', ') })}</span>}
                </div>
                <bdi className={s.referenceValue} data-reference-value>{formatValue(reference.value, valueFormat)}</bdi>
              </li>
            )
          })}
        </ol>
        <details className={s.referenceExact}>
          <summary>{t('exact')}</summary>
          <p>{t('exactDescription')}</p>
          <dl>{references.map((reference, index) => <div key={index}><dt>{t('unnamed', { number: index + 1 })}</dt><dd><bdi data-reference-exact>{exactReferenceValue(reference.value, locale)}</bdi></dd></div>)}</dl>
        </details>
      </section>
    </div>
  )
}
