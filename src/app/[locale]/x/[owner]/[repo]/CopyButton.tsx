'use client'

import { useState } from 'react'

import s from './report.module.css'

export default function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={s.copyButton}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        } catch {
          setCopied(false)
        }
      }}
    >
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  )
}
