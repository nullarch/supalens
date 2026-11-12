'use client'

import { Cell, Pie, PieChart, Tooltip } from 'recharts'
import { formatValue } from '@/lib/viz/format'
import type { SpecOf, WidgetComponentProps } from '../types'
import { CHART_PALETTE, chartHeight, seriesColor } from '../theme'
import { ChartFrame, useChartAnim } from './ChartFrame'
import { ClayTooltip } from './ClayTooltip'
import { resolveSlices } from './data'
import s from './charts.module.css'

type PieSpecT = SpecOf<'pie' | 'donut'>

/** Integer percents that sum to exactly 100 (largest-remainder), so the legend never
 *  reads 99/101%. Sub-1% slices show '<1%' instead of a misleading '0%'. */
function legendPercents(values: number[], total: number): string[] {
  if (total <= 0) return values.map(() => '—')
  const raw = values.map((v) => (v / total) * 100)
  const floor = raw.map((v) => Math.floor(v))
  let rem = 100 - floor.reduce((sum, v) => sum + v, 0)
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac)
  const pct = [...floor]
  for (let k = 0; k < order.length && rem > 0; k++) {
    pct[order[k].i]++
    rem--
  }
  return raw.map((r, i) => (r > 0 && r < 1 ? '<1%' : `${pct[i]}%`))
}

export function PieWidget({ spec, data, fill }: WidgetComponentProps<PieSpecT>) {
  const anim = useChartAnim()
  // default top-N cap so >8 categories fold into '기타' — no two slices share a palette color
  const slices = resolveSlices(data.rows, spec.category, spec.value, spec.limit ?? CHART_PALETTE.length)
  const total = slices.reduce((sum, sl) => sum + sl.value, 0)
  const pcts = legendPercents(
    slices.map((sl) => sl.value),
    total
  )
  const donut = spec.type === 'donut'
  // donut center defaults to a COMPACT total so a full KRW figure can't spill the ring
  const centerLabel = donut
    ? spec.centerLabel ?? String(formatValue(total, { kind: 'number', ...(spec.valueFormat ?? {}), compact: true }))
    : undefined
  const centerFont = centerLabel && centerLabel.length > 9 ? 15 : centerLabel && centerLabel.length > 6 ? 18 : 22

  return (
    <div className={s.pie} style={fill ? { height: '100%', alignItems: 'stretch' } : undefined}>
      <div className={s.pieCanvas} style={fill ? { height: '100%' } : undefined}>
        <ChartFrame height={fill ? '100%' : chartHeight(spec)}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={donut ? '66%' : 0}
              outerRadius="86%"
              paddingAngle={slices.length > 1 ? 1.5 : 0}
              stroke="var(--paper-2)"
              strokeWidth={2}
              isAnimationActive={anim.isAnimationActive}
              animationDuration={anim.animationDuration}
            >
              {slices.map((sl, i) => (
                <Cell key={sl.name} fill={seriesColor(i)} />
              ))}
            </Pie>
            <Tooltip content={<ClayTooltip valueFmt={spec.valueFormat} hideName={false} />} />
          </PieChart>
        </ChartFrame>
        {donut && (
          <div className={s.pieCenter}>
            <span className={s.pieCenterVal} style={{ fontSize: centerFont }}>
              {centerLabel}
            </span>
          </div>
        )}
      </div>

      <ul className={s.pieLegend}>
        {slices.map((sl, i) => (
          <li key={sl.name} className={s.pieLegendItem}>
            <span className={s.swatch} style={{ background: seriesColor(i) }} />
            <span className={s.pieLegendName}>{sl.name}</span>
            <span className={s.pieLegendPct}>{pcts[i]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
