'use client'

import { useState } from 'react'

import s from './v3.module.css'

// Dev-only theme flip (same mechanism as /dev/modals DevThemeToggle: <html data-theme>),
// bottom-right so it never enters the editorial composition.
export function ThemeToggle() {
  const [dark, setDark] = useState(false)
  return (
    <button
      type="button"
      className={s.themeToggle}
      onClick={() => {
        const next = !dark
        setDark(next)
        document.documentElement.dataset.theme = next ? 'dark' : 'light'
      }}
    >
      {dark ? '☀ light' : '☾ dark'}
    </button>
  )
}
