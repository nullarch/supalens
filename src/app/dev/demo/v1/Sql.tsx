import type { ReactNode } from 'react'

import s from './v1.module.css'

// Tiny server-side SQL highlighter for the dev-only V1 demo mock. Deliberately naive
// (comments / strings / numbers / keywords / functions) — it colors hand-picked static
// SQL from the demo KPI catalog, nothing user-supplied.
const TOKEN =
  /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|(\b(?:select|from|where|and|or|not|group|order|by|join|on|as|filter|limit|interval|desc|asc|distinct)\b)|(\b(?:coalesce|sum|count|avg|round|nullif|date_trunc|now|current_date)\b)/gi

export function Sql({ code }: { code: string }) {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const cls = m[1] ? s.sqlCom : m[2] ? s.sqlStr : m[3] ? s.sqlNum : m[4] ? s.sqlKw : s.sqlFn
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < code.length) out.push(code.slice(last))
  return <pre className={s.sql}>{out}</pre>
}
