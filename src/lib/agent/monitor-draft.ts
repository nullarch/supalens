/**
 * "Turn into monitor" — the pure half of the Ask → Monitors bridge.
 *
 * An answer the user liked is the best possible monitor proposal: the SQL already ran, against
 * the right source, and produced the number they care about. These helpers turn a finished run
 * into a prefilled `/app/monitors` create-form link. No React, no io — the seam is a URL, so the
 * monitors page owns validation exactly as it does for a hand-typed monitor.
 */

/** Longest name we put in the query string; monitor names are a label, not a prose field. */
const MAX_NAME = 80

/**
 * Does this SELECT plainly return more than one column?
 *
 * A monitor's metric SQL must reduce to ONE scalar. We cannot parse SQL properly here (and must
 * not try), so this is a deliberately shallow read of the select list: split at the top level
 * between `select` and its matching `from`, and look for a comma outside parentheses/quotes.
 * `select *` counts as multi-column. Anything we can't read confidently returns false — the CTA
 * still works, the form still validates on submit; this only decides which LABEL to show.
 */
export function looksMultiColumn(sql: string): boolean {
  const selectList = topLevelSelectList(sql)
  if (selectList === null) return false
  if (/(^|[\s,(])\*\s*$/.test(selectList) || selectList.trim() === '*') return true
  return hasTopLevelComma(selectList)
}

/** The text between the first top-level `select` and its matching `from` (null when unreadable). */
function topLevelSelectList(sql: string): string | null {
  const lowered = sql.toLowerCase()
  const selectAt = lowered.search(/\bselect\b/)
  if (selectAt < 0) return null
  let depth = 0
  let quote: string | null = null
  for (let i = selectAt + 'select'.length; i < sql.length; i++) {
    const c = sql[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0 && lowered.startsWith('from', i) && isWordBoundary(lowered, i, i + 4)) {
      return sql.slice(selectAt + 'select'.length, i)
    }
  }
  // A `from`-less scalar select (`select 1`) is single-column by construction.
  return sql.slice(selectAt + 'select'.length)
}

function isWordBoundary(s: string, start: number, end: number): boolean {
  const before = start === 0 ? ' ' : s[start - 1]
  const after = end >= s.length ? ' ' : s[end]
  return !/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)
}

function hasTopLevelComma(list: string): boolean {
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) return true
  }
  return false
}

/**
 * The create-form deep link. `new=sql` matches the link the monitors page already publishes for
 * its own "SQL로 직접" menu entry, so both entry points open the same prefilled form.
 */
export function buildMonitorHref(args: { dataSourceId: string; name: string; sql: string }): string {
  const p = new URLSearchParams({ new: 'sql', source: args.dataSourceId, sql: args.sql })
  const name = args.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME)
  if (name) p.set('name', name)
  return `/app/monitors?${p.toString()}`
}
