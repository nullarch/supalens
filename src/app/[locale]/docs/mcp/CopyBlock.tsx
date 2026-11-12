'use client'

import { useEffect, useRef, useState } from 'react'
import s from './copy-block.module.css'

/** Clipboard access is opt-in; rejection leaves the command selectable and explains recovery. */
export function CopyBlock({ code, label, copyLabel, copiedLabel, copyingLabel, failedLabel }: {
  code: string; label: string; copyLabel: string; copiedLabel: string; copyingLabel: string; failedLabel: string
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle')
  const pending = useRef(false)
  const version = useRef(0)
  useEffect(() => {
    const activeVersion = ++version.current
    setState('idle')
    pending.current = false
    return () => { version.current = activeVersion + 1 }
  }, [code])

  async function copy() {
    if (pending.current) return
    pending.current = true
    const requestVersion = version.current
    setState('pending')
    try {
      await navigator.clipboard.writeText(code)
      if (requestVersion === version.current) setState('copied')
    } catch {
      if (requestVersion === version.current) setState('failed')
    } finally {
      if (requestVersion === version.current) pending.current = false
    }
  }

  return (
    <div className={s.block}>
      <div className={s.toolbar}><span>{label}</span><button type="button" onClick={copy} disabled={state === 'pending'}>
        {state === 'pending' ? copyingLabel : copyLabel}
      </button></div>
      <pre tabIndex={0} role="region" aria-label={label}><code>{code}</code></pre>
      <p role="status" data-state={state} className={state === 'failed' ? s.failure : s.notice}>
        {state === 'copied' ? copiedLabel : state === 'failed' ? failedLabel : state === 'pending' ? copyingLabel : ''}
      </p>
    </div>
  )
}
