import { DEMO_KPI_PROPOSALS } from '@/lib/kpi/demo-catalog'

// Localized-title clones of canned demo-catalog specs for the onboarding wizard — the same
// clone idiom as the public /demo page, shared by /app/ask and /dev/wizard. These clones are
// DISPLAY-ONLY (rendered from their inline sample, never re-run), so reshaping the sample for
// the wizard's small cells is safe.

type Translate = (key: string) => string

/**
 * daily_revenue gets compact category labels: the stock date axis renders the full localized
 * date ("2026년 6월 23일"), and 8 of those angled at -35° consume most of a ~185px wizard cell
 * (ko/ja are the worst case). Full-width cells (Act 3 sample) use "M/D"; the half-width Act 1
 * replay cell (`replay: true`) trims to the trailing 6 days with day-of-month-only labels —
 * anything longer collides.
 */
export function wizardSpec(tDemo: Translate, key: string, opts?: { replay?: boolean }): unknown {
  const p = DEMO_KPI_PROPOSALS.find((x) => x.key === key)
  if (!p) return null
  const chart: Record<string, unknown> = { ...p.vizSpec.chart, title: tDemo(`payoffTitles.${key}`) }
  delete chart.description
  delete chart.caption
  let sample = p.vizSpec.sample
  if (key === 'daily_revenue' && sample) {
    const rows = opts?.replay ? sample.rows.slice(-6) : sample.rows
    sample = {
      ...sample,
      rows: rows.map((row) => {
        const r = row as Record<string, unknown>
        const d = new Date(String(r.day))
        if (Number.isNaN(d.getTime())) return r
        return { ...r, day: opts?.replay ? String(d.getDate()) : `${d.getMonth() + 1}/${d.getDate()}` }
      }),
    }
    chart.xFormat = { kind: 'string' }
  }
  return { ...p.vizSpec, chart, sample }
}
