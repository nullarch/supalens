// The MCP App view for Supalens results: what Claude (and other MCP Apps hosts) draw inline in
// the conversation when a data tool answers.
//
// It receives the tool result from the host — never from the network — and draws it: the charts
// an analysis chose (get_analysis), or a conservatively inferred form for a bare query result
// (execute_sql and the document tools). Every figure has a table one click away, so nothing is
// readable only through a chart. A host without MCP Apps support never loads this file and shows
// the text answer instead.
//
// Built into one self-contained HTML file by scripts/build-mcp-app.mjs and served as the
// ui://supalens/result.html resource. The decisions live in model.ts (pure, unit-tested); this
// file only paints.
//
// Everything that comes from the user's database (column names, categories, values) is set with
// textContent / createTextNode, never as HTML.

import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps'

import { computeDelta, formatTick, formatValue, othersLabel, setVizLocale } from '@/lib/viz/format'
import type { ChartSpec, Format } from '@/lib/viz/spec'

import {
  figuresFrom,
  niceScale,
  pickTicks,
  stackExtent,
  toCartesian,
  toNumber,
  toSlices,
  valueExtent,
  type Figure,
  type Row,
  type Table,
} from './model'

// ── copy ────────────────────────────────────────────────────────────────────
// Three languages, like the app. English keys; the host's locale picks the column.

const COPY = {
  en: {
    chart: 'Chart', table: 'Table', result: 'Query result', loading: 'Running…', cancelled: 'Cancelled.',
    nothing: 'Nothing to draw for this result.', running: 'The analysis is still running.',
    rows: (shown: number, total: number) => `Showing ${shown} of ${total} rows`,
    truncated: 'The result was cut at the row limit.', noRows: 'No rows.',
    hidden: (n: number) => `${n} more series are in the table.`,
    inferred: 'Chart chosen from the shape of the result.', total: 'Total', vs: 'vs', target: 'Target',
  },
  ko: {
    chart: '차트', table: '표', result: '쿼리 결과', loading: '실행 중…', cancelled: '취소되었습니다.',
    nothing: '이 결과로 그릴 내용이 없습니다.', running: '분석이 아직 실행 중입니다.',
    rows: (shown: number, total: number) => `${total}행 중 ${shown}행 표시`,
    truncated: '행 수 제한에서 결과가 잘렸습니다.', noRows: '행이 없습니다.',
    hidden: (n: number) => `나머지 ${n}개 계열은 표에서 볼 수 있습니다.`,
    inferred: '결과의 형태에 맞춰 고른 차트입니다.', total: '합계', vs: '대비', target: '목표',
  },
  ja: {
    chart: 'チャート', table: '表', result: 'クエリ結果', loading: '実行中…', cancelled: 'キャンセルされました。',
    nothing: 'この結果には描画する内容がありません。', running: '分析はまだ実行中です。',
    rows: (shown: number, total: number) => `${total} 行中 ${shown} 行を表示`,
    truncated: '行数の上限で結果が切り詰められました。', noRows: '行がありません。',
    hidden: (n: number) => `残り ${n} 系列は表で確認できます。`,
    inferred: '結果の形に合わせて選んだチャートです。', total: '合計', vs: '対', target: '目標',
  },
} as const
let t: (typeof COPY)[keyof typeof COPY] = COPY.en

const root = document.getElementById('root') as HTMLElement
const app = new App({ name: 'Supalens result', version: '1.0.0' })

// ── tiny DOM helpers ────────────────────────────────────────────────────────

type Child = Node | string | null | undefined | false
function h<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

const SVG = 'http://www.w3.org/2000/svg'
function s(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  if (text !== undefined) node.textContent = text
  return node
}

const color = (i: number) => `var(--s${(i % 8) + 1})`
const px = (n: number) => Number(n.toFixed(1))

// ── tooltip (one, shared) ───────────────────────────────────────────────────

const tip = h('div', 'tip')
tip.hidden = true
tip.setAttribute('role', 'status')

interface TipRow {
  name?: string
  value: string
  color?: string
}
function showTip(x: number, y: number, head: string, rows: TipRow[]): void {
  tip.replaceChildren(
    ...(head ? [h('div', 'tip-head', head)] : []),
    ...rows.map((r) => {
      const key = h('span', 'k')
      if (r.color) key.style.background = r.color
      return h('div', 'tip-row', key, h('span', 'n', r.name ?? ''), h('span', 'v', r.value))
    }),
  )
  tip.hidden = false
  const box = tip.getBoundingClientRect()
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - box.width - 8)
  const top = y + 16 + box.height > window.innerHeight ? Math.max(8, y - box.height - 12) : y + 16
  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
}
const hideTip = () => { tip.hidden = true }

// ── table ───────────────────────────────────────────────────────────────────

// rows drawn; the wrapper scrolls, so a long result never takes over the conversation
const TABLE_ROWS = 100
// an identifier is a label that happens to be digits: no thousands separators
const ID_COLUMN = /(^|_)id$/i

function table(data: Table, spec?: Extract<ChartSpec, { type: 'table' }>): HTMLElement {
  if (data.rows.length === 0) return h('p', 'state', t.noRows)
  const cols = (spec?.columns ?? data.columns.slice(0, 50).map((key) => ({ key }))) as {
    key: string
    label?: string
    format?: Format
    align?: string
  }[]
  const numeric = cols.map((c) => data.rows.every((r) => r[c.key] == null || toNumber(r[c.key]) !== null) && data.rows.some((r) => r[c.key] != null))
  const limit = Math.min(spec?.limit ?? TABLE_ROWS, TABLE_ROWS)
  const shown = data.rows.slice(0, limit)

  const head = h('tr')
  cols.forEach((c, i) => {
    const th = h('th', numeric[i] && c.align !== 'left' ? 'num' : '', c.label ?? c.key)
    th.scope = 'col'
    head.append(th)
  })
  const body = h('tbody')
  for (const row of shown) {
    const tr = h('tr')
    cols.forEach((c, i) => {
      const v = row[c.key]
      const empty = v === null || v === undefined
      const text = empty ? '—' : c.format || (numeric[i] && !ID_COLUMN.test(c.key)) ? formatValue(v, c.format) : typeof v === 'object' ? JSON.stringify(v) : String(v)
      const td = h('td', `${numeric[i] && c.align !== 'left' ? 'num' : ''}${empty ? ' nil' : ''}`.trim(), text)
      if (text.length > 28) td.title = text
      tr.append(td)
    })
    body.append(tr)
  }
  const el = h('div', '', h('div', 'table-wrap', h('table', '', h('thead', '', head), body)))
  const total = data.rowCount ?? data.rows.length
  const notes = [total > shown.length ? t.rows(shown.length, total) : '', data.truncated ? t.truncated : ''].filter(Boolean)
  if (notes.length) el.append(h('p', 'fig-note', notes.join(' ')))
  return el
}

// ── stat tile ───────────────────────────────────────────────────────────────

function stat(chart: Extract<ChartSpec, { type: 'kpi' | 'bignumber' }>, rows: Row[]): HTMLElement {
  const row = rows[0] ?? {}
  const el = h('div', '', h('div', 'stat-value', formatValue(row[chart.value], chart.format)))
  if (chart.type === 'bignumber') {
    if (chart.caption) el.append(h('div', 'stat-sub', chart.caption))
    return el
  }
  const sub = h('div', 'stat-sub')
  if (chart.comparison) {
    const prior = row[chart.comparison.value]
    const d = computeDelta(row[chart.value], prior)
    if (d.direction !== 'flat' && d.deltaAbs !== null) {
      const good = (d.direction === 'up') === (chart.comparison.goodDirection !== 'down')
      const text =
        chart.comparison.mode === 'percent' && d.deltaPct !== null
          ? formatValue(Math.abs(d.deltaPct), { kind: 'percent', decimals: 1 })
          : formatValue(Math.abs(d.deltaAbs), chart.format)
      // direction is carried by the arrow and the sign of the wording, not by colour alone
      sub.append(h('span', good ? 'delta-up' : 'delta-down', `${d.direction === 'up' ? '▲' : '▼'} ${text}`), ' ')
    }
    sub.append(`${t.vs} ${formatValue(prior, chart.format)}`)
  }
  if (chart.target !== undefined) sub.append(sub.childNodes.length ? ' · ' : '', `${t.target} ${formatValue(chart.target, chart.format)}`)
  if (sub.childNodes.length) el.append(sub)
  return el
}

// ── legend ──────────────────────────────────────────────────────────────────

function legend(names: string[], mark: 'box' | 'line'): HTMLElement {
  const ul = h('ul', 'legend')
  names.forEach((name, i) => {
    const key = h('span', mark === 'line' ? 'key line' : 'key')
    key.style.background = color(i)
    ul.append(h('li', '', key, name))
  })
  return ul
}

// ── cartesian (vertical bars, lines, areas) ─────────────────────────────────

type CartesianSpec = Extract<ChartSpec, { type: 'bar' | 'stackedBar' | 'groupedBar' | 'line' | 'multiLine' | 'area' }>

/** A bar with a 4px rounded data-end and a square baseline end. */
function barPath(x: number, y0: number, y1: number, w: number, round: boolean): string {
  const top = Math.min(y0, y1)
  const bottom = Math.max(y0, y1)
  const r = round ? Math.min(4, w / 2, (bottom - top) / 2) : 0
  if (r <= 0) return `M${px(x)},${px(top)}h${px(w)}V${px(bottom)}h${px(-w)}Z`
  return y1 <= y0
    ? `M${px(x)},${px(bottom)}V${px(top + r)}q0,${-r} ${r},${-r}h${px(w - 2 * r)}q${r},0 ${r},${r}V${px(bottom)}Z`
    : `M${px(x)},${px(top)}V${px(bottom - r)}q0,${r} ${r},${r}h${px(w - 2 * r)}q${r},0 ${r},${-r}V${px(top)}Z`
}

function axisFormat(f: Format | undefined, max: number): Format | undefined {
  // compact on an axis that reaches 10,000; in full below it — one style per axis
  return Math.abs(max) >= 10_000 ? { ...(f ?? { kind: 'number' }), compact: true } : f
}

function cartesian(chart: CartesianSpec, rows: Row[], width: number): HTMLElement {
  const { categories, series, hiddenSeries } = toCartesian(chart, rows)
  const el = h('div')
  if (categories.length === 0 || series.length === 0) return h('p', 'state', t.noRows)

  const isBar = chart.type === 'bar' || chart.type === 'stackedBar' || chart.type === 'groupedBar'
  const stacked = chart.type === 'stackedBar' || (chart.type === 'area' && chart.stacked && series.length > 1)
  const isArea = chart.type === 'area'
  const refs = chart.references ?? []

  const ext = stacked ? stackExtent(series) : valueExtent(series)
  const lo = Math.min(ext.min, ...refs.map((r) => r.value))
  const hi = Math.max(ext.max, ...refs.map((r) => r.value))
  const scale = niceScale(lo, hi, { zero: isBar || isArea })
  const yFmt = axisFormat(chart.yFormat, Math.max(Math.abs(scale.min), Math.abs(scale.max)))
  const yLabels = scale.ticks.map((v) => formatTick(v, yFmt))

  const H = 240
  const left = Math.min(92, Math.max(30, Math.max(...yLabels.map((l) => l.length)) * 6.4 + 12))
  const right = 14
  const top = 12
  const bottom = 26
  const plotW = Math.max(60, width - left - right)
  const plotH = H - top - bottom
  const n = categories.length
  const band = plotW / n
  const cx = (i: number) => left + (isBar ? band * (i + 0.5) : n === 1 ? plotW / 2 : (plotW * i) / (n - 1))
  const y = (v: number) => top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH
  const zero = y(Math.min(Math.max(0, scale.min), scale.max))
  const xLabel = (i: number) => formatTick(categories[i], chart.xFormat)

  const svg = s('svg', { viewBox: `0 0 ${width} ${H}`, height: H, class: 'plot', role: 'img', tabindex: 0, 'aria-label': chart.title })

  // grid + y ticks (recessive), then the baseline
  scale.ticks.forEach((v, i) => {
    svg.append(s('line', { class: 'grid', x1: left, x2: left + plotW, y1: px(y(v)), y2: px(y(v)) }))
    svg.append(s('text', { x: left - 8, y: px(y(v) + 3.5), 'text-anchor': 'end' }, yLabels[i]))
  })
  const hover = s('g', {})
  svg.append(hover)

  // x ticks: as many as fit without touching, first and last always
  const longest = Math.max(...categories.map((_, i) => xLabel(i).length))
  for (const i of pickTicks(n, Math.max(2, Math.floor(plotW / (longest * 6.4 + 28))))) {
    const anchor = !isBar && i === 0 ? 'start' : !isBar && i === n - 1 ? 'end' : 'middle'
    svg.append(s('text', { x: px(cx(i)), y: H - 8, 'text-anchor': anchor }, xLabel(i)))
  }

  if (isBar) {
    const groups = stacked ? 1 : series.length
    const gap = 2
    const thick = Math.max(1, Math.min(24, (band * 0.72 - gap * (groups - 1)) / groups))
    const groupW = thick * groups + gap * (groups - 1)
    for (let i = 0; i < n; i++) {
      let up = 0
      let down = 0
      const lastUp = stacked ? series.map((sr) => (sr.values[i] ?? 0) > 0).lastIndexOf(true) : -1
      series.forEach((sr, k) => {
        const v = sr.values[i]
        if (v === null || v === 0) return
        const x = cx(i) - groupW / 2 + (stacked ? 0 : k * (thick + gap))
        if (!stacked) {
          svg.append(s('path', { d: barPath(x, zero, y(v), thick, true), fill: color(k) }))
          return
        }
        const from = v > 0 ? up : down
        if (v > 0) up += v
        else down += v
        const a = y(from)
        const b = y(from + v)
        // a 2px surface gap between segments does the separating, not a stroke
        const inset = from === 0 ? 0 : v > 0 ? -gap : gap
        if (Math.abs(b - a) <= Math.abs(inset)) return
        svg.append(s('path', { d: barPath(x, a + inset, b, thick, k === lastUp), fill: color(k) }))
      })
    }
    // a value on the cap only where it is one series and the labels have room
    if (series.length === 1 && n <= 12 && band >= 34) {
      series[0].values.forEach((v, i) => {
        if (v === null) return
        svg.append(s('text', { class: 'val', x: px(cx(i)), y: px(y(v) + (v >= 0 ? -5 : 13)), 'text-anchor': 'middle' }, formatTick(v, yFmt)))
      })
    }
  } else {
    const points = (values: (number | null)[]) => values.map((v, i) => (v === null ? null : ([cx(i), y(v)] as const)))
    const runs = (pts: (readonly [number, number] | null)[]) => {
      const out: (readonly [number, number])[][] = []
      let run: (readonly [number, number])[] = []
      for (const p of pts) {
        if (p) run.push(p)
        else if (run.length) { out.push(run); run = [] }
      }
      if (run.length) out.push(run)
      return out
    }
    const path = (run: (readonly [number, number])[]) => run.map(([a, b], i) => `${i ? 'L' : 'M'}${px(a)},${px(b)}`).join('')

    let lower: number[] = Array.from({ length: n }, () => 0)
    series.forEach((sr, k) => {
      const values = stacked ? sr.values.map((v, i) => (v ?? 0) + lower[i]) : sr.values
      if (isArea) {
        // the wash: the series hue at low opacity down to its base (zero, or the series below)
        for (const run of runs(points(values))) {
          const first = Math.round(((run[0][0] - left) / plotW) * (n - 1)) || 0
          const base = run.map(([a], j) => `L${px(a)},${px(stacked ? y(lower[first + j]) : zero)}`).reverse().join('')
          svg.append(s('path', { d: `${path(run)}${base}Z`, fill: color(k), 'fill-opacity': stacked ? 0.28 : 0.1 }))
        }
      }
      for (const run of runs(points(values))) {
        svg.append(s('path', { d: path(run), fill: 'none', stroke: color(k), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }))
        if (run.length === 1) svg.append(s('circle', { class: 'ring', cx: px(run[0][0]), cy: px(run[0][1]), r: 4, fill: color(k) }))
      }
      const lastIndex = values.reduce<number>((a, v, i) => (v === null ? a : i), -1)
      if (lastIndex >= 0 && n > 1) {
        svg.append(s('circle', { class: 'ring', cx: px(cx(lastIndex)), cy: px(y(values[lastIndex] as number)), r: 4, fill: color(k) }))
      }
      if (stacked) lower = values as number[]
    })
  }

  for (const r of refs) {
    svg.append(s('line', { class: 'ref', x1: left, x2: left + plotW, y1: px(y(r.value)), y2: px(y(r.value)) }))
    svg.append(s('text', { class: 'val', x: left + plotW, y: px(y(r.value) - 5), 'text-anchor': 'end' }, `${r.label ?? ''} ${formatTick(r.value, yFmt)}`.trim()))
  }
  svg.append(s('line', { class: 'axis', x1: left, x2: left + plotW, y1: px(zero), y2: px(zero) }))

  // hover / keyboard: the pointer only has to be nearest a category — one readout, every series
  let active = -1
  const show = (i: number, clientX?: number, clientY?: number) => {
    active = i
    hover.replaceChildren(
      isBar
        ? s('rect', { class: 'band', x: px(left + band * i), y: top, width: px(band), height: plotH })
        : s('line', { class: 'cross', x1: px(cx(i)), x2: px(cx(i)), y1: top, y2: top + plotH }),
    )
    const box = svg.getBoundingClientRect()
    const fx = clientX ?? box.left + (cx(i) / width) * box.width
    const fy = clientY ?? box.top + top
    showTip(
      fx,
      fy,
      formatValue(categories[i], chart.xFormat),
      series.map((sr, k) => ({
        name: series.length > 1 ? sr.name : undefined,
        value: sr.values[i] === null ? '—' : formatValue(sr.values[i], chart.yFormat),
        color: color(k),
      })),
    )
  }
  const clear = () => { active = -1; hover.replaceChildren(); hideTip() }
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect()
    const xIn = ((e.clientX - box.left) / box.width) * width
    const i = isBar ? Math.floor((xIn - left) / band) : Math.round(((xIn - left) / plotW) * (n - 1))
    show(Math.min(n - 1, Math.max(0, i)), e.clientX, e.clientY)
  })
  svg.addEventListener('pointerleave', clear)
  svg.addEventListener('blur', clear)
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    show(Math.min(n - 1, Math.max(0, active + (e.key === 'ArrowRight' ? 1 : active < 0 ? 0 : -1))))
  })

  el.append(svg)
  if (series.length > 1) el.append(legend(series.map((sr) => sr.name), isBar || isArea ? 'box' : 'line'))
  if (hiddenSeries > 0) el.append(h('p', 'fig-note', t.hidden(hiddenSeries)))
  return el
}

// ── horizontal bars (one series: magnitude by category, label and value on every row) ──

function horizontalBars(chart: CartesianSpec, rows: Row[]): HTMLElement {
  const { categories, series } = toCartesian(chart, rows)
  const values = series[0]?.values ?? []
  const max = Math.max(...values.map((v) => Math.abs(v ?? 0)), 0) || 1
  const el = h('div', 'hbars')
  categories.forEach((cat, i) => {
    const v = values[i]
    const label = h('span', 'hbar-label', formatValue(cat, chart.xFormat))
    label.title = label.textContent ?? ''
    const fill = h('span', 'hbar-fill')
    fill.style.width = `${((Math.abs(v ?? 0) / max) * 100).toFixed(2)}%`
    const track = h('span', 'hbar-track', fill)
    el.append(label, track, h('span', 'hbar-value', v === null ? '—' : formatValue(v, chart.yFormat)))
  })
  return el
}

// ── slices ──────────────────────────────────────────────────────────────────

function slices(chart: Extract<ChartSpec, { type: 'pie' | 'donut' }>, rows: Row[]): HTMLElement {
  const parts = toSlices(chart.limit ? rows.slice(0, chart.limit) : rows, chart.category, chart.value, othersLabel())
  if (parts.length === 0) return h('p', 'state', t.noRows)
  const R = 80
  const inner = chart.type === 'donut' ? 50 : 0
  const svg = s('svg', { viewBox: '-84 -84 168 168', role: 'img', 'aria-label': chart.title })
  const total = parts.reduce((a, p) => a + p.value, 0)
  let angle = -Math.PI / 2
  const at = (a: number, r: number) => `${px(Math.cos(a) * r)},${px(Math.sin(a) * r)}`
  parts.forEach((p, i) => {
    const sweep = p.share * Math.PI * 2
    // a full circle cannot be one arc; a single slice is drawn as two halves
    const steps = p.share > 0.999 ? 2 : 1
    for (let k = 0; k < steps; k++) {
      const a0 = angle + (sweep / steps) * k
      const a1 = angle + (sweep / steps) * (k + 1)
      const large = a1 - a0 > Math.PI ? 1 : 0
      const d = inner
        ? `M${at(a0, R)}A${R},${R} 0 ${large} 1 ${at(a1, R)}L${at(a1, inner)}A${inner},${inner} 0 ${large} 0 ${at(a0, inner)}Z`
        : `M0,0L${at(a0, R)}A${R},${R} 0 ${large} 1 ${at(a1, R)}Z`
      const path = s('path', { d, fill: color(i), class: parts.length > 1 ? 'ring' : '' })
      path.addEventListener('pointermove', (e) =>
        showTip((e as PointerEvent).clientX, (e as PointerEvent).clientY, p.label, [
          { value: `${formatValue(p.value, chart.valueFormat)} · ${formatValue(p.share, { kind: 'percent', decimals: 1 })}`, color: color(i) },
        ]),
      )
      path.addEventListener('pointerleave', hideTip)
      svg.append(path)
    }
    angle += sweep
  })
  if (inner) {
    svg.append(s('text', { class: 'center', x: 0, y: -4, 'text-anchor': 'middle' }, t.total))
    // the centre always states the computed total; a spec's own centre text may be stale or a caption
    svg.append(s('text', { class: 'val', x: 0, y: 14, 'text-anchor': 'middle', 'font-size': 14 }, formatValue(total, { ...(chart.valueFormat ?? { kind: 'number' }), compact: true })))
  }
  // the legend carries every label, value and share — identity never rests on colour alone
  const ul = h('ul', 'legend')
  parts.forEach((p, i) => {
    const key = h('span', 'key')
    key.style.background = color(i)
    ul.append(h('li', '', key, h('span', '', p.label), h('span', 'v', formatValue(p.value, chart.valueFormat)), h('span', 'share', formatValue(p.share, { kind: 'percent', decimals: 1 }))))
  })
  return h('div', 'slices', svg, ul)
}

// ── scatter ─────────────────────────────────────────────────────────────────

function scatter(chart: Extract<ChartSpec, { type: 'scatter' }>, rows: Row[], width: number): HTMLElement {
  // three identities at most: with every pair of colours adjacent, a fourth cannot be told apart
  const names = chart.series ? [...new Set(rows.map((r) => String(r[chart.series as string] ?? '—')))] : []
  const grouped = names.length >= 2 && names.length <= 3
  const pts = rows
    .map((r) => ({ x: toNumber(r[chart.x]), y: toNumber(r[chart.y]), k: grouped ? names.indexOf(String(r[chart.series as string] ?? '—')) : 0, row: r }))
    .filter((p): p is { x: number; y: number; k: number; row: Row } => p.x !== null && p.y !== null)
  if (pts.length === 0) return h('p', 'state', t.noRows)

  const xs = niceScale(Math.min(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.x)), { zero: false })
  const ys = niceScale(Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.y)), { zero: false })
  const xFmt = axisFormat(chart.xFormat, Math.max(Math.abs(xs.min), Math.abs(xs.max)))
  const yFmt = axisFormat(chart.yFormat, Math.max(Math.abs(ys.min), Math.abs(ys.max)))
  const yLabels = ys.ticks.map((v) => formatTick(v, yFmt))
  const H = 260
  const left = Math.min(92, Math.max(30, Math.max(...yLabels.map((l) => l.length)) * 6.4 + 12))
  const top = 22
  const plotW = Math.max(60, width - left - 16)
  const plotH = H - top - 40
  const X = (v: number) => left + ((v - xs.min) / (xs.max - xs.min)) * plotW
  const Y = (v: number) => top + plotH - ((v - ys.min) / (ys.max - ys.min)) * plotH

  const svg = s('svg', { viewBox: `0 0 ${width} ${H}`, height: H, class: 'plot', role: 'img', 'aria-label': chart.title })
  ys.ticks.forEach((v, i) => {
    svg.append(s('line', { class: 'grid', x1: left, x2: left + plotW, y1: px(Y(v)), y2: px(Y(v)) }))
    svg.append(s('text', { x: left - 8, y: px(Y(v) + 3.5), 'text-anchor': 'end' }, yLabels[i]))
  })
  xs.ticks.forEach((v) => svg.append(s('text', { x: px(X(v)), y: top + plotH + 16, 'text-anchor': 'middle' }, formatTick(v, xFmt))))
  svg.append(s('text', { x: left + plotW, y: H - 4, 'text-anchor': 'end' }, `${chart.x} →`))
  svg.append(s('text', { x: left, y: 9, 'text-anchor': 'start' }, `↑ ${chart.y}`))
  svg.append(s('line', { class: 'axis', x1: left, x2: left + plotW, y1: top + plotH, y2: top + plotH }))
  const marker = s('circle', { r: 7, fill: 'none', stroke: 'var(--sv-ink)', 'stroke-width': 1.5, visibility: 'hidden' })
  for (const p of pts) svg.append(s('circle', { class: 'ring', cx: px(X(p.x)), cy: px(Y(p.y)), r: 4, fill: color(p.k) }))
  svg.append(marker)

  // nearest point wins: an 8px dot is not a target anyone hits reliably
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect()
    const mx = ((e.clientX - box.left) / box.width) * width
    const my = ((e.clientY - box.top) / box.height) * H
    let best = pts[0]
    let dist = Infinity
    for (const p of pts) {
      const d = (X(p.x) - mx) ** 2 + (Y(p.y) - my) ** 2
      if (d < dist) { dist = d; best = p }
    }
    if (dist > 40 ** 2) { marker.setAttribute('visibility', 'hidden'); hideTip(); return }
    marker.setAttribute('cx', String(px(X(best.x))))
    marker.setAttribute('cy', String(px(Y(best.y))))
    marker.setAttribute('visibility', 'visible')
    showTip(e.clientX, e.clientY, grouped ? names[best.k] : '', [
      { name: chart.x, value: formatValue(best.x, chart.xFormat) },
      { name: chart.y, value: formatValue(best.y, chart.yFormat) },
    ])
  })
  svg.addEventListener('pointerleave', () => { marker.setAttribute('visibility', 'hidden'); hideTip() })

  const el = h('div', '', svg)
  if (grouped) el.append(legend(names, 'box'))
  return el
}

// ── figure ──────────────────────────────────────────────────────────────────

function plot(fig: Figure, width: number): HTMLElement {
  const { chart, data } = fig
  switch (chart.type) {
    case 'table':
      return table(data, chart)
    case 'kpi':
    case 'bignumber':
      return data.rows.length ? stat(chart, data.rows) : h('p', 'state', t.noRows)
    case 'pie':
    case 'donut':
      return slices(chart, data.rows)
    case 'scatter':
      return scatter(chart, data.rows, width)
    default: {
      const single = !chart.series && !(Array.isArray(chart.y) && chart.y.length > 1)
      const horizontal = 'orientation' in chart && chart.orientation === 'horizontal'
      return horizontal && single ? horizontalBars(chart, data.rows) : cartesian(chart, data.rows, width)
    }
  }
}

function figure(fig: Figure, width: number): HTMLElement {
  const { chart, data } = fig
  const body = h('div')
  const head = h('div', 'fig-head', h('div', '', h('h2', 'fig-title', chart.title), chart.description ? h('p', 'fig-desc', chart.description) : null))
  const el = h('section', 'fig', head, body)
  const inner = Math.max(220, width - 36)

  const draw = (mode: 'chart' | 'table') => {
    hideTip()
    body.replaceChildren(mode === 'table' ? table(data) : plot(fig, inner))
    if (mode === 'chart' && fig.inferred && chart.type !== 'table') body.append(h('p', 'fig-note', t.inferred))
  }
  // a stat tile IS its value — a table of one cell adds nothing
  if (chart.type !== 'table' && chart.type !== 'kpi' && chart.type !== 'bignumber') {
    // the table view: every value a chart shows is reachable without hovering
    const buttons = (['chart', 'table'] as const).map((mode) => {
      const b = h('button', '', t[mode])
      b.type = 'button'
      b.setAttribute('aria-pressed', String(mode === 'chart'))
      b.addEventListener('click', () => {
        for (const other of buttons) other.setAttribute('aria-pressed', String(other === b))
        draw(mode)
      })
      return b
    })
    head.append(h('div', 'toggle', ...buttons))
  }
  draw('chart')
  return el
}

// ── host wiring ─────────────────────────────────────────────────────────────

let current: { figures: Figure[]; note?: string } | null = null

function render(): void {
  if (!current) return
  const width = Math.max(260, root.clientWidth || 600)
  if (current.figures.length === 0) {
    root.replaceChildren(h('p', 'state', current.note ?? t.nothing), tip)
    return
  }
  root.replaceChildren(...current.figures.map((f) => figure(f, width)), tip)
}

function message(text: string, error = false): void {
  current = null
  root.replaceChildren(h('p', error ? 'state err' : 'state', text), tip)
}

function payloadOf(result: { structuredContent?: unknown; content?: { type: string; text?: string }[] }): unknown {
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent
  const text = result.content?.find((c) => c.type === 'text')?.text
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

type HostContext = ReturnType<App['getHostContext']>
function applyContext(ctx: HostContext): void {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
  const lang = (ctx.locale ?? '').slice(0, 2).toLowerCase()
  if (lang) {
    document.documentElement.lang = lang
    setVizLocale(lang)
    t = COPY[lang as keyof typeof COPY] ?? COPY.en
  }
  render()
}

app.ontoolinput = () => message(t.loading)
app.ontoolcancelled = () => message(t.cancelled)
app.ontoolresult = (result) => {
  const r = result as { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] }
  if (r.isError) {
    message(r.content?.find((c) => c.type === 'text')?.text ?? t.nothing, true)
    return
  }
  const payload = payloadOf(r)
  const pending = !!payload && typeof payload === 'object' && (payload as { done?: unknown }).done === false
  current = { figures: figuresFrom(payload, t.result), note: pending ? t.running : undefined }
  render()
}
app.onhostcontextchanged = (ctx) => applyContext(ctx as HostContext)

// redraw at the new width: SVG text must not scale with the container
let lastWidth = 0
new ResizeObserver(() => {
  const w = root.clientWidth
  if (Math.abs(w - lastWidth) < 8) return
  lastWidth = w
  render()
}).observe(root)

// `build-mcp-app.mjs --preview` seeds a tool result so the view can be looked at in a plain
// browser tab. A host never sets this; without it the view only ever draws what the host sends.
const seeded = (globalThis as { __SUPALENS_RESULT_PREVIEW__?: unknown }).__SUPALENS_RESULT_PREVIEW__
if (seeded) {
  app.ontoolresult?.(seeded as never)
} else {
  app
    .connect()
    .then(() => applyContext(app.getHostContext()))
    .catch(() => message(t.nothing))
}
