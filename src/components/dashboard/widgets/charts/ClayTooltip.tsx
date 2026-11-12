'use client'

import { formatValue } from '@/lib/viz/format'
import type { Format } from '@/lib/viz/spec'
import s from './charts.module.css'

interface TooltipEntry {
  name?: string | number
  value?: unknown
  color?: string
  dataKey?: string | number
}

interface ClayTooltipProps {
  active?: boolean
  payload?: TooltipEntry[]
  label?: unknown
  /** format for the axis label (x value) */
  labelFmt?: Format
  /** format for the series values (y values) */
  valueFmt?: Format
  /** hide series name (single-series charts) */
  hideName?: boolean
}

/** The chart tooltip: a small paper card — mono category label, then one row per
 *  series (swatch · name · tabular value). Pass as `content={<ClayTooltip .../>}`. */
export function ClayTooltip({ active, payload, label, labelFmt, valueFmt, hideName }: ClayTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className={s.tooltip}>
      {label != null && label !== '' && (
        <div className={s.tooltipLabel}>{formatValue(label, labelFmt ?? { kind: 'string' })}</div>
      )}
      {payload.map((entry, i) => (
        <div className={s.tooltipRow} key={`${String(entry.dataKey)}-${i}`}>
          {entry.color && <span className={s.swatch} style={{ background: entry.color }} />}
          {!hideName && entry.name != null && <span className={s.tooltipName}>{String(entry.name)}</span>}
          <span className={s.tooltipVal}>{formatValue(entry.value, valueFmt)}</span>
        </div>
      ))}
    </div>
  )
}
