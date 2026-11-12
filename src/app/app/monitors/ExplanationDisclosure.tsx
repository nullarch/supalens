import { Fragment } from 'react'

import { explanationPreview } from '@/lib/alerts/explanation-text'
import s from './explanation.module.css'

/** `**bold**` is the only markdown the agent's prose leans on; everything else renders as text. */
function renderInline(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

/**
 * The root-cause agent's explanation, collapsed to its lead sentence with a native <details> toggle
 * for the full text. No hooks, so the client monitor list and the server detail view share it.
 * `inline` puts the badge beside the sentence (one table row); `stacked` puts it above, matching
 * the "confirmed" fact it sits under in the timelines.
 */
export function ExplanationDisclosure({
  text,
  label,
  moreLabel,
  lessLabel,
  layout = 'inline',
  className,
}: {
  text: string
  label: string
  moreLabel: string
  lessLabel: string
  layout?: 'inline' | 'stacked'
  className?: string
}) {
  const preview = explanationPreview(text)
  if (!preview) return null
  const badge = <span className={`dx-badge dx-badge-bloom ${s.badge}`}>{label}</span>
  const root = className ? `${s.root} ${className}` : s.root

  if (!preview.hasMore) {
    return (
      <div className={root} data-layout={layout}>
        <div className={s.head}>
          {badge}
          <p className={s.lead}>{renderInline(preview.paragraphs[0])}</p>
        </div>
      </div>
    )
  }

  return (
    <details className={root} data-layout={layout}>
      <summary className={`${s.head} ${s.summary}`}>
        {badge}
        <span className={s.lead}>{preview.summary}</span>
        {/* <details> already exposes the expanded state; the visible words are a sighted cue only */}
        <span className={s.toggle} aria-hidden>
          <span className={s.more}>{moreLabel}</span>
          <span className={s.less}>{lessLabel}</span>
        </span>
      </summary>
      <div className={s.body}>
        {preview.paragraphs.map((p, i) => (
          <p key={i}>{renderInline(p)}</p>
        ))}
      </div>
    </details>
  )
}
