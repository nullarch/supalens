'use client'

import { useEffect, useId, useRef, useState } from 'react'

import s from './ask-chat.module.css'

export interface PickerSource {
  id: string
  name: string
  engine?: string
  provider?: string
  context?: 'schema' | 'code'
  isDemo?: boolean
}

/**
 * Custom data-source picker for the chat composer — replaces the native `<select>` (whose
 * open state is the ugly browser dropdown). A quiet labeled trigger + a token-styled listbox
 * that opens UPWARD (the composer is pinned to the bottom), with click-outside, Escape, and
 * arrow-key nav.
 * Mirrors the repo's existing hand-rolled menus (Sidebar org switcher); no new dependency.
 */
export function SourcePicker({
  sources,
  value,
  onChange,
  label,
  demoLabel,
}: {
  sources: PickerSource[]
  value: string
  onChange: (id: string) => void
  label: string
  /** localized badge for the demo source (kept as a prop so this stays a pure presentational
   *  component — the translator lives in the parent) */
  demoLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const [placement, setPlacement] = useState({ up: true, width: 260, height: 300 })
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = sources.find((d) => d.id === value)
  const activeIndex = Math.max(0, sources.findIndex((d) => d.id === value))

  // focus the active option when the panel opens
  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus()
  }, [open, activeIndex])

  useEffect(() => {
    if (!open) return
    function position() {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom
      const up = rect.top > below
      setPlacement({ up, width: Math.min(320, window.innerWidth - rect.left - 16), height: Math.min(300, Math.max(64, (up ? rect.top : below) - 20)) })
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [open])

  function show() {
    if (!sources.length) return
    setFocusIndex(activeIndex)
    setOpen(true)
  }

  function close(refocus = true) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      show()
    }
  }

  function onPanelKeyDown(e: React.KeyboardEvent, i: number) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') {
      close(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      optionRefs.current[Math.min(i + 1, sources.length - 1)]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      optionRefs.current[Math.max(i - 1, 0)]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      optionRefs.current[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      optionRefs.current[sources.length - 1]?.focus()
    }
  }

  return (
    <span className={s.sourceChip} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(false) }}>
      <button
        ref={triggerRef}
        type="button"
        className={s.sourceTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        disabled={!sources.length}
        title={selected?.name}
        onClick={() => open ? close() : show()}
        onKeyDown={onTriggerKeyDown}
      >
        {/* The visible key repeats the accessible name; the button aria-label stays the source label. */}
        <span className={s.sourceKey} aria-hidden>{label}</span>
        <span className={s.sourceGlyph}>
          <SourceGlyph source={selected} />
        </span>
        <span className={s.sourceTriggerLabel}>{selected?.name ?? label}</span>
        <svg className={s.sourceChev} data-open={open} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          <div className={s.sourceBackdrop} aria-hidden onClick={() => close(false)} />
          <ul id={panelId} className={s.sourcePanel} role="listbox" aria-label={label} data-up={placement.up}
            style={{ width: placement.width, maxHeight: placement.height }}>
            {sources.map((d, i) => {
              const active = d.id === value
              return (
                <li key={d.id} role="presentation">
                  <button
                    ref={(el) => {
                      optionRefs.current[i] = el
                    }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    tabIndex={focusIndex === i ? 0 : -1}
                    onFocus={() => setFocusIndex(i)}
                    className={s.sourceOption}
                    data-active={active}
                    onClick={() => {
                      onChange(d.id)
                      close()
                    }}
                    onKeyDown={(e) => onPanelKeyDown(e, i)}
                  >
                    <span className={s.sourceOptionGlyph}>
                      <SourceGlyph source={d} />
                    </span>
                    <span className={s.sourceOptionName}>{d.name}</span>
                    {d.isDemo && <span className={s.sourceTag}>{demoLabel}</span>}
                    {active && (
                      <svg className={s.sourceCheck} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m5 12 4.5 4.5L19 7" />
                      </svg>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </span>
  )
}

/** Single-stroke source-family glyph (matches the DbMark aesthetic elsewhere). */
function SourceGlyph({ source }: { source?: PickerSource }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (source?.isDemo) {
    // beaker — the sample/demo source
    return (
      <svg {...common}>
        <path d="M9 3h6M10 3v6l-4.5 8a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L14 9V3" />
        <path d="M7 15h10" />
      </svg>
    )
  }
  if (source?.engine === 'firestore' || source?.provider === 'firebase') {
    // flame — Firestore/Firebase
    return (
      <svg {...common}>
        <path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1-.5-2-.5-2 2 1 3.5 3 3.5 5.5A5 5 0 0 1 7 13.5C7 9 12 8 12 3z" />
      </svg>
    )
  }
  // database cylinder — postgres / mysql / supabase / generic
  return (
    <svg {...common}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </svg>
  )
}
