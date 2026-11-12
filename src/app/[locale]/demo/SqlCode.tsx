'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Copy } from 'lucide-react'

import s from './DemoConsole.module.css'

// Naive highlighter for SQL the demo analyst wrote (comments, strings, numbers, keywords,
// functions). Output is React text, so nothing in the query is ever interpreted as markup.
const TOKEN =
  /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|(\b(?:select|from|where|and|or|not|in|is|null|group|order|by|join|left|right|inner|outer|on|as|with|filter|limit|interval|desc|asc|distinct|case|when|then|else|end|having|over|partition|between|union|all|date|numeric|int)\b)|(\b(?:coalesce|sum|count|avg|min|max|round|nullif|date_trunc|now|current_date|extract|lag|lead|row_number|rank|to_char|generate_series)\b)/gi

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const match of code.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > last) out.push(code.slice(last, index))
    const cls = match[1] ? s.sqlComment : match[2] ? s.sqlString : match[3] ? s.sqlNumber : match[4] ? s.sqlKeyword : s.sqlFunction
    out.push(
      <span key={i++} className={cls}>
        {match[0]}
      </span>,
    )
    last = index + match[0].length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

export function SqlCode({ sql }: { sql: string }) {
  const t = useTranslations('demo.answer')
  const [copied, setCopied] = useState(false)
  const code = sql.trim()

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={s.sqlBlock}>
      <button type="button" className={s.copyButton} onClick={() => void copy()} aria-live="polite">
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {copied ? t('copied') : t('copy')}
      </button>
      <pre className={s.sql} tabIndex={0} aria-label="SQL">
        {highlight(code)}
      </pre>
    </div>
  )
}
