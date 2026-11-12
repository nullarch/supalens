'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import type { SeriesPoint } from '@/lib/alerts/condition'
import s from './goal.module.css'

const pad = { top: 12, right: 12, bottom: 12, left: 12 }

/**
 * The approval chart: the daily series, the rule's rolling usual-range edge(s) as dashed lines,
 * and a marker on every day the rule would have fired. Plain SVG (no charting bundle) — the card
 * re-renders on every slider step, and this is three paths and a few circles.
 */
export function SeriesBandChart({
  points,
  bands,
  firedBuckets,
  format,
  bound,
  label,
  height = 180,
}: {
  points: SeriesPoint[]
  bands: Array<{ lower: number | null; upper: number | null } | null>
  firedBuckets: string[]
  format: (n: number) => string
  /** how a usual-range edge reads (the card rounds count edges to the exact integer) */
  bound?: (v: number, side: 'lower' | 'upper') => string
  /** accessible summary of what the chart shows */
  label: string
  height?: number
}) {
  // draw in real pixels (no preserveAspectRatio stretch — markers stay round at any width)
  const figRef = useRef<HTMLElement | null>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const el = figRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [hover, setHover] = useState<number | null>(null)

  const geo = useMemo(() => {
    const vals: number[] = []
    for (const p of points) vals.push(p.value)
    for (const b of bands) {
      if (b?.lower != null) vals.push(b.lower)
      if (b?.upper != null) vals.push(b.upper)
    }
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    if (min === max) {
      min -= 1
      max += 1
    }
    const span = max - min
    min -= span * 0.08
    max += span * 0.08
    const innerW = width - pad.left - pad.right
    const innerH = height - pad.top - pad.bottom
    const x = (i: number) => pad.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
    const y = (v: number) => pad.top + innerH - ((v - min) / (max - min)) * innerH
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
    const edge = (side: 'lower' | 'upper') => {
      let d = ''
      let open = false
      bands.forEach((b, i) => {
        const v = b?.[side]
        if (v == null) {
          open = false
          return
        }
        d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
        open = true
      })
      return d.trim()
    }
    const fired = new Set(firedBuckets)
    return {
      x,
      y,
      line,
      lower: edge('lower'),
      upper: edge('upper'),
      fired: points.map((p, i) => (p.bucket && fired.has(p.bucket) ? i : -1)).filter((i) => i >= 0),
      innerW,
    }
  }, [points, bands, firedBuckets, height, width])

  if (points.length === 0) return null
  const last = points.length - 1
  const shown = hover ?? last
  const hp = points[shown]
  const hb = bands[shown]

  return (
    <figure className={s.chart} ref={figRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={label}
        className={s.chartSvg}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const rel = ((e.clientX - rect.left) / rect.width) * width
          const i = Math.round(((rel - pad.left) / geo.innerW) * (points.length - 1))
          setHover(Math.max(0, Math.min(last, i)))
        }}
      >
        {geo.lower && <path d={geo.lower} className={s.chartEdge} />}
        {geo.upper && <path d={geo.upper} className={s.chartEdge} />}
        <path d={geo.line} className={s.chartLine} />
        {geo.fired.map((i) => (
          <circle key={i} cx={geo.x(i)} cy={geo.y(points[i].value)} r={4.5} className={s.chartFired} />
        ))}
        <circle cx={geo.x(shown)} cy={geo.y(hp.value)} r={3.5} className={s.chartFocus} />
        {hover !== null && <line x1={geo.x(shown)} x2={geo.x(shown)} y1={pad.top} y2={height - pad.bottom} className={s.chartCursor} />}
      </svg>
      <figcaption className={s.chartCaption}>
        <span className={s.chartAxis}>{points[0].bucket}</span>
        <span className={s.chartReadout} aria-live="polite">
          <strong>{format(hp.value)}</strong>
          {hp.bucket && <span> · {hp.bucket}</span>}
          {hb && (hb.lower != null || hb.upper != null) && (
            <span className={s.chartRange}>
              {' '}
              · {hb.lower != null ? `≥ ${bound ? bound(hb.lower, 'lower') : format(hb.lower)}` : ''}
              {hb.lower != null && hb.upper != null ? ' · ' : ''}
              {hb.upper != null ? `≤ ${bound ? bound(hb.upper, 'upper') : format(hb.upper)}` : ''}
            </span>
          )}
        </span>
        <span className={s.chartAxis}>{points[last].bucket}</span>
      </figcaption>
    </figure>
  )
}
