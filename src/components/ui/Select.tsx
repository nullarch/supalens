'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

import s from './Select.module.css'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  /** Shown on the trigger when `value` matches no option (or is empty with no matching option). */
  placeholder?: string
  ariaLabel?: string
  id?: string
  disabled?: boolean
  /** Extra class on the trigger button (used by the marketing language switcher). */
  className?: string
  /** Extra style/class on the positioning root — e.g. `flex: 1` inside a flex row. */
  rootClassName?: string
  rootStyle?: React.CSSProperties
  size?: 'sm' | 'md'
  /** Fill the container width (form fields); default sizes to content. */
  block?: boolean
  /** `field` = bordered control; `bare` = chrome-less so `className` owns the look. */
  variant?: 'field' | 'bare'
}

/**
 * The one dropdown component for the whole app — replaces every native `<select>` so the
 * open menu is our own listbox (paper/clay tokens) instead of the browser's OS dropdown.
 * Accessible listbox: click / Enter / Space / arrows / Home / End / Escape, click-outside to
 * close, auto-flips upward near the viewport bottom. Options carry plain string labels (every
 * call site used simple text), so this stays a controlled `value`/`onValueChange` control.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  ariaLabel,
  id,
  disabled,
  className,
  rootClassName,
  rootStyle,
  size = 'md',
  block = false,
  variant = 'field',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const [focusIdx, setFocusIdx] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const autoId = useId()
  const fid = id ?? autoId

  const selected = options.find((o) => o.value === value)
  const selectedIdx = Math.max(0, options.findIndex((o) => o.value === value))

  // Keyboard navigation scrolls this list, not the enclosing page/dialog.
  useEffect(() => {
    if (!open) return
    const option = optionRefs.current[focusIdx], panel = panelRef.current
    option?.focus({ preventScroll: true })
    if (option && panel) {
      const top = option.offsetTop, bottom = top + option.offsetHeight
      if (top < panel.scrollTop) panel.scrollTop = top
      else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight
    }
  }, [open, focusIdx])

  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current, panel = panelRef.current
    if (!trigger || !panel) return
    const position = () => {
      const rect = trigger.getBoundingClientRect()
      const root = trigger.parentElement!.getBoundingClientRect()
      const gutter = 8, gap = 6
      if (rect.bottom < gutter || rect.top > window.innerHeight - gutter) { setOpen(false); return }
      const above = rect.top - gutter - gap, below = window.innerHeight - rect.bottom - gutter - gap
      const up = below < 280 && above > below
      setDropUp(up)
      const minimum = Math.min(rect.width, window.innerWidth - gutter * 2)
      panel.style.minWidth = `${Math.max(0, minimum)}px`
      panel.style.maxWidth = `${Math.max(minimum, Math.min(340, window.innerWidth - gutter * 2))}px`
      panel.style.maxHeight = `${Math.max(0, Math.min(280, up ? above : below))}px`
      const width = panel.getBoundingClientRect().width
      panel.style.left = `${Math.max(gutter, Math.min(root.left, window.innerWidth - gutter - width)) - root.left}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(trigger)
    observer.observe(panel)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open])

  function openMenu() {
    if (disabled) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const below = window.innerHeight - rect.bottom
      // flip up only when the menu clearly won't fit below and there's more room above
      setDropUp(below < 260 && rect.top > below)
    }
    setFocusIdx(selectedIdx)
    setOpen(true)
  }

  function close(refocus = true) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  /** step to the next enabled option in `dir` from index `from` (inclusive scan). */
  function moveFocus(from: number, dir: 1 | -1) {
    let i = from
    for (let step = 0; step < options.length; step++) {
      i += dir
      if (i < 0 || i >= options.length) return
      if (!options[i].disabled) {
        setFocusIdx(i)
        return
      }
    }
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu()
    }
  }

  function onOptionKeyDown(e: React.KeyboardEvent, i: number) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close()
        break
      case 'ArrowDown':
        e.preventDefault()
        moveFocus(i, 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveFocus(i, -1)
        break
      case 'Home':
        e.preventDefault()
        moveFocus(-1, 1)
        break
      case 'End':
        e.preventDefault()
        moveFocus(options.length, -1)
        break
      case 'Tab':
        close(false)
        break
    }
  }

  function pick(opt: SelectOption) {
    if (opt.disabled) return
    onValueChange(opt.value)
    close()
  }

  return (
    <div
      className={cn(s.root, rootClassName)}
      style={rootStyle}
      data-block={block || undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        id={fid}
        className={cn(s.trigger, className)}
        data-size={size}
        data-variant={variant}
        data-open={open}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={selected?.label}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={cn(s.label, !selected && s.placeholder)}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <svg
          className={s.chev}
          data-open={open}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          <div className={s.backdrop} aria-hidden onClick={() => close(false)} />
          <ul ref={panelRef} className={s.panel} data-drop={dropUp ? 'up' : 'down'} role="listbox" aria-label={ariaLabel} aria-activedescendant={`${fid}-opt-${focusIdx}`}>
            {options.map((opt, i) => {
              const active = opt.value === value
              return (
                <li key={opt.value || `opt-${i}`} role="option" aria-selected={active}>
                  <button
                    ref={(el) => {
                      optionRefs.current[i] = el
                    }}
                    id={`${fid}-opt-${i}`}
                    type="button"
                    className={s.option}
                    data-active={active || undefined}
                    data-focus={focusIdx === i || undefined}
                    disabled={opt.disabled}
                    onClick={() => pick(opt)}
                    onKeyDown={(e) => onOptionKeyDown(e, i)}
                  >
                    <span className={s.optionLabel}>{opt.label}</span>
                    {active && (
                      <svg
                        className={s.check}
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
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
    </div>
  )
}
