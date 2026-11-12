'use client'

import { useEffect, useId, useRef, useState } from 'react'
import s from './monitors.module.css'

/** Local disclosure only; opening the menu never evaluates or changes a monitor. */
export function RowActionsMenu({ id, label, disabled, items }: {
  id: string
  label: string
  disabled: boolean
  items: { label: string; destructive?: boolean; expanded?: boolean; onSelect: () => void }[]
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const fromEnd = useRef(false)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    const choices = root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')
    choices?.[fromEnd.current ? choices.length - 1 : 0]?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div className={s.rowMenuRoot} ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus()
    }
  }}>
    <button ref={button} id={id} type="button" className={s.moreButton} disabled={disabled}
      aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => { fromEnd.current = false; setOpen(value => !value) }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); fromEnd.current = event.key === 'ArrowUp'; setOpen(true)
        }
      }}>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden><circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" /></svg>
    </button>
    {open && <div id={menuId} className={s.rowMenu} role="menu" aria-label={label} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const choices = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      const index = choices.indexOf(document.activeElement as HTMLElement)
      choices[event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]?.focus()
    }}>
      {items.map(item => <button type="button" role="menuitem" tabIndex={-1} key={item.label}
        className={s.rowMenuItem} data-destructive={item.destructive || undefined} aria-expanded={item.expanded}
        onClick={() => { setOpen(false); button.current?.focus(); item.onSelect() }}>{item.label}</button>)}
    </div>}
  </div>
}
