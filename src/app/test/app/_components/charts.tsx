/* ============================================================
   Prototype charts — pure CSS/SVG, NO charting lib. Every fill is a
   flat colour from the `.tx` ink ramp (--tx-series-1..5) with at most
   ONE clay-highlighted element per chart (--tx-hi). Axis/labels are
   11px mono at --cx-text-ter. No gradients, no shadows, no animation.
   ============================================================ */

import type { BarDatum, Segment, Series } from './sample-data'
import c from './charts.module.css'

// Non-highlighted elements read the ink ramp. Clamp to the 5 defined steps.
function ink(step: number): string {
  const n = Math.min(Math.max(step, 1), 5)
  return `var(--tx-series-${n})`
}

/* ---------------- horizontal bars (ask result) ---------------- */
export function HBarChart({ data }: { data: BarDatum[] }) {
  const max = Math.max(...data.map((d) => d.value))
  return (
    <div className={c.hbar}>
      {data.map((d, i) => (
        <div key={d.label} className={c.hbarRow}>
          <span className={c.hbarLabel}>{d.label}</span>
          <span className={c.hbarTrack}>
            <span
              className={c.hbarFill}
              style={{ width: `${(d.value / max) * 100}%`, background: d.highlight ? 'var(--tx-hi)' : ink(i) }}
            />
          </span>
          <span className={c.hbarValue}>{d.display}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------------- vertical bars (monthly revenue) ---------------- */
export function VBarChart({ data }: { data: BarDatum[] }) {
  const max = Math.max(...data.map((d) => d.value))
  return (
    <div className={c.vbar}>
      {data.map((d, i) => (
        <div key={d.label} className={c.vbarCol}>
          <span className={c.vbarValueTop}>{d.display}</span>
          <span className={c.vbarTrack}>
            <span
              className={c.vbarFill}
              // history fades up toward the clay current month (older = lighter)
              style={{ height: `${(d.value / max) * 100}%`, background: d.highlight ? 'var(--tx-hi)' : ink(5 - i) }}
            />
          </span>
          <span className={c.vbarLabel}>{d.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------------- donut (category mix) ---------------- */
export function Donut({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: Segment[]
  centerValue: string
  centerLabel: string
}) {
  let cum = 0
  return (
    <div className={c.donutWrap}>
      <div className={c.donut}>
        <svg viewBox="0 0 120 120" className={c.donutSvg} aria-hidden>
          {/* rotate -90 so the ring starts at 12 o'clock; pathLength=100 lets
              us author dash lengths directly as percentages */}
          <g transform="rotate(-90 60 60)">
            {segments.map((seg, i) => {
              const dash = seg.pct
              const offset = -cum
              cum += seg.pct
              return (
                <circle
                  key={seg.label}
                  cx="60"
                  cy="60"
                  r="46"
                  fill="none"
                  strokeWidth="15"
                  pathLength={100}
                  stroke={seg.highlight ? 'var(--tx-hi)' : ink(i + 1)}
                  strokeDasharray={`${dash} ${100 - dash}`}
                  strokeDashoffset={offset}
                />
              )
            })}
          </g>
        </svg>
        <div className={c.donutCenter}>
          <span className={c.donutValue}>{centerValue}</span>
          <span className={c.donutLabel}>{centerLabel}</span>
        </div>
      </div>
      <ul className={c.legend}>
        {segments.map((seg, i) => (
          <li key={seg.label} className={c.legendItem}>
            <span
              className={c.legendDot}
              style={{ background: seg.highlight ? 'var(--tx-hi)' : ink(i + 1) }}
            />
            <span className={c.legendName}>{seg.label}</span>
            <span className={c.legendVal}>{seg.display}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------------- line (weekly signups) ---------------- */
export function LineChart({ series, xLabels }: { series: Series[]; xLabels: string[] }) {
  const W = 320
  const H = 130
  const padX = 6
  const padTop = 12
  const padBottom = 6
  const all = series.flatMap((s) => s.points)
  const max = Math.max(...all)
  const min = Math.min(...all)
  const span = max - min || 1
  const n = series[0]?.points.length ?? 1
  const px = (i: number) => padX + (i / (n - 1)) * (W - 2 * padX)
  const py = (v: number) => padTop + (1 - (v - min) / span) * (H - padTop - padBottom)
  const gridRows = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className={c.line}>
      <div className={c.lineLegend}>
        {series.map((s) => (
          <span key={s.name} className={c.lineLegendItem}>
            <span className={c.legendDot} style={{ background: s.highlight ? 'var(--tx-hi)' : ink(2) }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className={c.lineSvg} preserveAspectRatio="none" aria-hidden>
        {gridRows.map((g) => (
          <line
            key={g}
            x1={padX}
            x2={W - padX}
            y1={padTop + g * (H - padTop - padBottom)}
            y2={padTop + g * (H - padTop - padBottom)}
            className={c.gridLine}
          />
        ))}
        {series.map((s) => (
          <polyline
            key={s.name}
            points={s.points.map((v, i) => `${px(i)},${py(v)}`).join(' ')}
            fill="none"
            stroke={s.highlight ? 'var(--tx-hi)' : ink(2)}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className={c.lineXAxis}>
        {xLabels.map((x) => (
          <span key={x} className={c.lineX}>
            {x}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------------- table (ask result + top products) ---------------- */
export function DataTable({
  columns,
  rows,
  numericFrom = 1,
}: {
  columns: string[]
  rows: string[][]
  // columns at or after this index are right-aligned (numbers)
  numericFrom?: number
}) {
  return (
    <table className={c.table}>
      <thead>
        <tr>
          {columns.map((col, i) => (
            <th key={col} className={i >= numericFrom ? c.right : undefined}>
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci} className={ci >= numericFrom ? c.right : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
