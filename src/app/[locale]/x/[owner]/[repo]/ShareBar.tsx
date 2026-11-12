'use client'

import { useState } from 'react'
import { Download, Link2 } from 'lucide-react'

import s from './report.module.css'

interface Labels {
  title: string
  note: string
  x: string
  linkedin: string
  copy: string
  copied: string
  download: string
}

/** Share row under the grade: intent links (no SDKs, no trackers), copy-link, and the card image. */
export default function ShareBar({ pageUrl, cardUrl, postText, labels }: { pageUrl: string; cardUrl: string; postText: string; labels: Labels }) {
  const [copied, setCopied] = useState(false)
  const xHref = `https://twitter.com/intent/tweet?text=${encodeURIComponent(postText)}&url=${encodeURIComponent(pageUrl)}`
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(pageUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={s.share}>
      <div className={s.shareCopy}>
        <span className={s.shareTitle}>{labels.title}</span>
        <span className={s.shareNote}>{labels.note}</span>
      </div>
      <div className={s.shareActions}>
        <a className={s.shareButton} href={xHref} target="_blank" rel="noopener noreferrer">
          {labels.x}
        </a>
        <a className={s.shareButton} href={linkedinHref} target="_blank" rel="noopener noreferrer">
          {labels.linkedin}
        </a>
        <button type="button" className={s.shareButton} onClick={() => void copy()}>
          <Link2 size={16} aria-hidden />
          <span aria-live="polite">{copied ? labels.copied : labels.copy}</span>
        </button>
        <a className={`${s.shareButton} ${s.shareDark}`} href={cardUrl} download>
          <Download size={16} aria-hidden />
          {labels.download}
        </a>
      </div>
    </div>
  )
}
