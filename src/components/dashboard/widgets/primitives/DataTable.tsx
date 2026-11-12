import { formatValue } from '@/lib/viz/format'
import { useTranslations } from 'next-intl'
import { coerceNum } from '../charts/data'
import type { SpecOf, WidgetComponentProps } from '../types'
import s from './primitives.module.css'

type TableSpecT = SpecOf<'table'>

export function DataTable({ spec, data }: WidgetComponentProps<TableSpecT>) {
  const t = useTranslations('appDashboards')
  // spec.columns is required (min 1) but fall back to result columns defensively
  const cols =
    spec.columns && spec.columns.length > 0
      ? spec.columns
      : data.columns.map((key) => ({ key, label: undefined, format: undefined, align: undefined }))

  let rows = data.rows
  if (spec.sort) {
    const { by, dir } = spec.sort
    rows = [...rows].sort((a, b) => {
      const av = coerceNum(a[by])
      const bv = coerceNum(b[by])
      if (av != null && bv != null) return dir === 'asc' ? av - bv : bv - av
      return dir === 'asc' ? String(a[by]).localeCompare(String(b[by])) : String(b[by]).localeCompare(String(a[by]))
    })
  }
  if (spec.limit && rows.length > spec.limit) rows = rows.slice(0, spec.limit)

  return (
    <div className={s.tableWrap} tabIndex={0} role="region" aria-label={t('widget.tableRegion', { title: spec.title })}>
      <table className={s.table}>
        {rows.length < data.rows.length && <caption className={s.tableCaption}>{t('widget.visibleRows', { shown: rows.length, total: data.rows.length })}</caption>}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} scope="col" aria-sort={spec.sort?.by === c.key ? spec.sort.dir === 'asc' ? 'ascending' : 'descending' : undefined} style={{ textAlign: c.align ?? alignFor(c.format?.kind) }}>
                {c.label ?? c.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => {
                const align = c.align ?? alignFor(c.format?.kind)
                // tabular figures track the column's DATA type, not its alignment
                const isNum = !!c.format?.kind && ['number', 'currency', 'percent', 'compact', 'duration'].includes(c.format.kind)
                return (
                  <td key={c.key} className={isNum ? s.num : undefined} style={{ textAlign: align }}>
                    {c.format ? formatValue(r[c.key], c.format) : stringify(r[c.key])}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function alignFor(kind?: string): 'left' | 'right' {
  return kind && ['number', 'currency', 'percent', 'compact', 'duration'].includes(kind) ? 'right' : 'left'
}

function stringify(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
