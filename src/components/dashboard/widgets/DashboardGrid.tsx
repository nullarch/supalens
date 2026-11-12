'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ChartSpec, WidgetData } from '@/lib/viz/spec'
import type { WidgetLayoutPatch } from '@/lib/dashboards/types'
import type { MonitorLink, WidgetKpiDefinition } from '@/lib/dashboards/monitor-links'
import type { WidgetSource } from '@/lib/dashboards/widget-source'
import { WidgetRenderer } from './WidgetRenderer'
import { MonitorFooter } from './MonitorFooter'
import s from './DashboardGrid.module.css'
import { BaseModal } from '@/components/modals/base-modal'
import { ModalButton, TextField, TextAreaField } from '@/components/modals/controls'
import { fitGridSize, gridResult, minimumGridRows, moveGridItem, resizeGridItem } from './grid-actions'

const COLS = 12
const ROW = 64 // px, must match grid-auto-rows in the CSS
const GAP = 16 // px, must match the grid gap in the CSS
const MIN_W = 3
const MAX_H = 12

export interface GridWidget {
  id: string
  spec: ChartSpec
  data: WidgetData
  /** default column span (1–12) */
  w?: number
  /** default row span */
  h?: number
  /** live re-run failed with no cached snapshot — render the error state, not "empty" */
  error?: boolean
  /** the monitor watching this metric, when one exists (report boards only) */
  monitor?: MonitorLink | null
  /** the verified KPI definition this widget came from (auto-KPI widgets only) */
  definition?: WidgetKpiDefinition | null
  /** the service the widget reads from — named above the title (null = no source; omitted = no line) */
  source?: WidgetSource | null
}

interface Size {
  w: number
  h: number
}
interface Layout {
  order: string[]
  sizes: Record<string, Size>
}
interface DragState {
  id: string
  px: number
  py: number
  gx: number
  gy: number
  w: number
  h: number
  dropIndex: number
}

function defaultsOf(widgets: GridWidget[], saved?: Layout): Layout {
  return {
    order: saved?.order ?? widgets.map((w) => w.id),
    sizes: Object.fromEntries(widgets.map((w) => [w.id, fitGridSize(
      saved?.sizes[w.id] ?? { w: w.w ?? 6, h: w.h ?? 4 }, minimumGridRows(w.spec.type, !!w.monitor),
    )])),
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Editable fields of a persisted widget, keyed by widget id (only real boards pass this). */
export interface WidgetEditMeta {
  title: string
  sql: string | null
  refreshInterval: number | null
}

export interface DashboardGridProps {
  widgets: GridWidget[]
  storageKey: string
  /** persisted layout from the DB; when present, localStorage hydration is skipped */
  initialLayout?: Layout
  /** persist callback (a server action). When provided, saves go here instead of localStorage. */
  onPersist?: (items: WidgetLayoutPatch[]) => unknown
  /** remove a widget (server action). Only wired for persisted boards; the ✕ shows in edit mode. */
  onRemoveWidget?: (id: string) => void | Promise<unknown>
  /** current editable values per widget; enables the ✎ button in edit mode. */
  editMeta?: Record<string, WidgetEditMeta>
  /** update a widget (server action) — title / SQL / refresh interval. */
  onUpdateWidget?: (
    id: string,
    patch: { title?: string; sql?: string; refreshInterval?: number | null },
  ) => Promise<{ ok: boolean; message?: string }>
  /** platform-staff flag (profiles.is_admin) — unlocks the read-only per-widget SQL debug panel. */
  isAdmin?: boolean
  /** Optional local clipboard adapter for isolated presentation tests. */
  onCopySql?: (sql: string) => Promise<void>
}

export function DashboardGrid(props: DashboardGridProps) {
  return <DashboardGridContent key={props.storageKey} {...props} />
}

function DashboardGridContent({ widgets, storageKey, initialLayout, onPersist, onRemoveWidget, editMeta, onUpdateWidget, isAdmin, onCopySql }: DashboardGridProps) {
  const t = useTranslations('appDashboards')
  const router = useRouter()
  const byId = new Map(widgets.map((w) => [w.id, w]))
  const lsKey = `supalens.dashlayout.${storageKey}`

  const [layout, setLayout] = useState<Layout>(() => defaultsOf(widgets, initialLayout))
  const [editing, setEditing] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const instructionsId = useId()
  const layoutToggle = useRef<HTMLButtonElement>(null)
  const mounted = useRef(true)
  const writeLock = useRef(false)
  const [writeBusy, setWriteBusy] = useState(false)
  const [pointerBusy, setPointerBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [layoutNotice, setLayoutNotice] = useState<'saving' | 'saved' | 'failed' | 'unknown' | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<'rejected' | 'unknown' | null>(null)
  const removeTrigger = useRef<HTMLButtonElement | null>(null)
  const pointerCleanup = useRef<(() => void) | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; pointerCleanup.current?.() }
  }, [])
  const locked = writeBusy || uncertain || pointerBusy

  // widget editor (title / SQL / refresh interval)
  const [editorId, setEditorId] = useState<string | null>(null)
  const [editorForm, setEditorForm] = useState({ title: '', sql: '', refresh: '' })
  const [editorBusy, setEditorBusy] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)

  // admin-only "how is this metric computed" debug panel (read-only SQL + provenance)
  const [debugId, setDebugId] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle')
  const copyGeneration = useRef(0)
  const copyBusy = useRef(false)
  // which widget's ⋯ menu is open (staff only)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const menuTrigger = useRef<HTMLButtonElement | null>(null)
  const menuItem = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { if (menuOpenId) menuItem.current?.focus() }, [menuOpenId])
  const debugMeta = debugId ? editMeta?.[debugId] : undefined
  const debugWidget = debugId ? byId.get(debugId) : undefined
  useEffect(() => {
    const generation = ++copyGeneration.current
    copyBusy.current = false
    setCopyState('idle')
    return () => { copyGeneration.current = generation + 1 }
  }, [debugId, debugMeta?.sql])

  const copySql = async (sql: string) => {
    if (copyBusy.current) return
    copyBusy.current = true
    const generation = copyGeneration.current
    setCopyState('pending')
    try {
      await (onCopySql ? onCopySql(sql) : navigator.clipboard.writeText(sql))
      if (mounted.current && generation === copyGeneration.current) setCopyState('copied')
    } catch {
      if (mounted.current && generation === copyGeneration.current) setCopyState('failed')
    } finally {
      if (generation === copyGeneration.current) copyBusy.current = false
    }
  }

  // Turns the widget's no-op ⋯ into a FUNCTIONAL dropdown menu, for staff only, on real boards
  // (editMeta present). The debug panel is an ITEM inside the ⋯ menu — not a standalone button
  // that replaces it — so the menu is the single home for per-widget staff actions. Returns
  // undefined for everyone else so no inactive menu is rendered.
  const debugMenu = (id: string) => {
    if (!isAdmin || !editMeta?.[id]) return undefined
    const open = menuOpenId === id
    return (
      <span className={s.menuAnchor}>
        <button
          type="button"
          className={s.kebabBtn}
          aria-label={t('widget.menu')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={event => { menuTrigger.current = event.currentTarget; setMenuOpenId((m) => (m === id ? null : id)) }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); menuTrigger.current = event.currentTarget; setMenuOpenId(id)
            }
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
            <circle cx="5.5" cy="12" r="1.4" fill="currentColor" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" />
            <circle cx="18.5" cy="12" r="1.4" fill="currentColor" />
          </svg>
        </button>
        {open && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setMenuOpenId(null)}
              className={s.menuScrim}
            />
            <div role="menu" aria-label={t('widget.menu')} className={s.menu} onKeyDown={event => {
              if (event.key === 'Escape' || event.key === 'Tab') {
                event.preventDefault(); setMenuOpenId(null); menuTrigger.current?.focus()
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault(); menuItem.current?.focus()
              }
            }}>
              <button
                ref={menuItem}
                type="button"
                role="menuitem"
                className={s.menuItem}
                onClick={() => {
                  setMenuOpenId(null)
                  setDebugId(id)
                }}
              >
                {t('debug.open')}
              </button>
            </div>
          </>
        )}
      </span>
    )
  }

  const openEditor = (id: string) => {
    if (writeLock.current || uncertain || pointerCleanup.current) return
    const meta = editMeta?.[id]
    if (!meta) return
    setEditorId(id)
    setEditorError(null)
    setEditorForm({ title: meta.title, sql: meta.sql ?? '', refresh: meta.refreshInterval ? String(meta.refreshInterval) : '' })
  }

  const saveEditor = async () => {
    if (!editorId || !onUpdateWidget || writeLock.current || uncertain || pointerCleanup.current) return
    const meta = editMeta?.[editorId]
    const patch: { title?: string; sql?: string; refreshInterval?: number | null } = {}
    if (editorForm.title.trim() && editorForm.title.trim() !== meta?.title) patch.title = editorForm.title.trim()
    if (meta?.sql !== null && editorForm.sql.trim() && editorForm.sql.trim() !== meta?.sql) patch.sql = editorForm.sql.trim()
    const refresh = editorForm.refresh.trim() === '' ? null : Number(editorForm.refresh)
    if (refresh !== (meta?.refreshInterval ?? null)) {
      if (refresh !== null && (!Number.isInteger(refresh) || refresh < 15)) {
        setEditorError(t('grid.refreshHint'))
        return
      }
      patch.refreshInterval = refresh
    }
    if (Object.keys(patch).length === 0) {
      setEditorId(null)
      return
    }
    writeLock.current = true
    setWriteBusy(true)
    setEditorBusy(true)
    setEditorError(null)
    try {
      const res = await onUpdateWidget(editorId, patch)
      if (!mounted.current) return
      const result = gridResult(res)
      if (result === 'confirmed') {
        setEditorId(null)
        try { router.refresh() } catch { setAnnouncement(t('grid.refreshFailed')) }
      } else {
        setEditorError(t(result === 'unknown' ? 'grid.changeUnknown' : 'grid.updateFailed'))
        if (result === 'unknown') setUncertain(true)
      }
    } catch {
      if (mounted.current) { setEditorError(t('grid.changeUnknown')); setUncertain(true) }
    } finally {
      if (mounted.current) { writeLock.current = false; setWriteBusy(false); setEditorBusy(false) }
    }
  }

  const gridRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const layoutRef = useRef(layout)
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  // hydrate persisted layout (client-only → no SSR mismatch), reconciled with current widgets.
  // Skipped when onPersist is set (DB mode): initialLayout from the server is the source of truth.
  useEffect(() => {
    if (onPersist) return
    try {
      const raw = localStorage.getItem(lsKey)
      if (!raw) return
      const saved = JSON.parse(raw) as Partial<Layout>
      const known = new Set(widgets.map((w) => w.id))
      const order = (saved.order ?? []).filter((id) => known.has(id))
      for (const w of widgets) if (!order.includes(w.id)) order.push(w.id)
      const sizes: Record<string, Size> = {}
      for (const w of widgets) {
        const sv = saved.sizes?.[w.id]
        sizes[w.id] = {
          w: clamp(sv?.w ?? w.w ?? 6, MIN_W, COLS),
          h: clamp(sv?.h ?? w.h ?? 4, minimumGridRows(w.spec.type, !!w.monitor), MAX_H),
        }
      }
      setLayout({ order, sizes })
    } catch {
      /* ignore corrupt storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsKey])

  const persist = useCallback(
    async (l: Layout) => {
      if (writeLock.current || uncertain || !mounted.current) return
      writeLock.current = true
      setWriteBusy(true)
      setLayoutNotice('saving')
      try {
        if (onPersist) {
          // Preserve the existing order/size payload; x/y remain reserved.
          const patches: WidgetLayoutPatch[] = l.order.map((id, i) => ({
            id,
            x: 0,
            y: 0,
            w: l.sizes[id].w,
            h: l.sizes[id].h,
            position: i,
          }))
          const result = gridResult(await onPersist(patches))
          if (!mounted.current) return
          setLayoutNotice(result === 'confirmed' ? 'saved' : result === 'rejected' ? 'failed' : 'unknown')
          if (result === 'unknown') setUncertain(true)
        } else {
          localStorage.setItem(lsKey, JSON.stringify(l))
          setLayoutNotice('saved')
        }
      } catch {
        if (!mounted.current) return
        setLayoutNotice(onPersist ? 'unknown' : 'failed')
        if (onPersist) setUncertain(true)
      } finally {
        if (mounted.current) { writeLock.current = false; setWriteBusy(false) }
      }
    },
    [lsKey, onPersist, uncertain]
  )

  const reset = () => {
    if (writeLock.current || uncertain || pointerCleanup.current) return
    const d = defaultsOf(widgets)
    // A locally confirmed removal must not reappear when resetting dimensions.
    d.order = d.order.filter(id => layoutRef.current.order.includes(id))
    layoutRef.current = d
    setLayout(d)
    void persist(d)
  }

  const removeWidget = async () => {
    if (!onRemoveWidget || !removeId || writeLock.current || uncertain || pointerCleanup.current) return
    const id = removeId
    if (!byId.has(id) || !layoutRef.current.order.includes(id)) return
    writeLock.current = true
    setWriteBusy(true)
    setRemoveError(null)
    try {
      const result = gridResult(await onRemoveWidget(id))
      if (!mounted.current) return
      if (result === 'confirmed') {
        const previous = layoutRef.current
        const sizes = { ...previous.sizes }
        delete sizes[id]
        const next = { order: previous.order.filter(value => value !== id), sizes }
        layoutRef.current = next
        setLayout(next)
        setRemoveId(null)
        setAnnouncement(t('grid.removed'))
      } else {
        setRemoveError(result)
        if (result === 'unknown') setUncertain(true)
      }
    } catch {
      if (mounted.current) { setRemoveError('unknown'); setUncertain(true) }
    } finally {
      if (mounted.current) { writeLock.current = false; setWriteBusy(false) }
    }
  }

  const keyboardLayout = (id: string, resize: boolean) => (event: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (writeLock.current || uncertain || pointerCleanup.current) return
    const previous = layoutRef.current
    if (resize) {
      if (!event.key.startsWith('Arrow')) return
      const widget = byId.get(id)!
      const size = resizeGridItem(previous.sizes[id], event.key, minimumGridRows(widget.spec.type, !!widget.monitor))
      if (size.w === previous.sizes[id].w && size.h === previous.sizes[id].h) return
      const next = { ...previous, sizes: { ...previous.sizes, [id]: size } }
      layoutRef.current = next
      setLayout(next)
      setAnnouncement(t('grid.resized', { title: byId.get(id)?.spec.title || t('grid.untitled'), ...size }))
      void persist(next)
    } else {
      const delta = event.key === 'Home' ? -previous.order.length : event.key === 'End' ? previous.order.length : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1
      const order = moveGridItem(previous.order, id, delta)
      if (order === previous.order) return
      const next = { ...previous, order }
      layoutRef.current = next
      setLayout(next)
      setAnnouncement(t('grid.moved', { title: byId.get(id)?.spec.title || t('grid.untitled'), position: order.indexOf(id) + 1, total: order.length }))
      void persist(next)
    }
  }

  // ── resize (drag the corner handle) ──
  const onResizeDown = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || writeLock.current || uncertain || pointerCleanup.current) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).focus()
    const grid = gridRef.current
    if (!grid) return
    const cellW = (grid.clientWidth - (COLS - 1) * GAP) / COLS
    const start = { x: e.clientX, y: e.clientY, ...layoutRef.current.sizes[id] }
    setPointerBusy(true)

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const dw = Math.round((ev.clientX - start.x) / (cellW + GAP))
      const dh = Math.round((ev.clientY - start.y) / (ROW + GAP))
      const w = clamp(start.w + dw, MIN_W, COLS)
      const widget = byId.get(id)!
      const h = clamp(start.h + dh, minimumGridRows(widget.spec.type, !!widget.monitor), MAX_H)
      const previous = layoutRef.current
      if (previous.sizes[id].w === w && previous.sizes[id].h === h) return
      const next = { ...previous, sizes: { ...previous.sizes, [id]: { w, h } } }
      layoutRef.current = next
      setLayout(next)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', keyCancel)
      pointerCleanup.current = null
      if (mounted.current) setPointerBusy(false)
    }
    const up = () => {
      cleanup()
      void persist(layoutRef.current)
    }
    const cancel = () => {
      cleanup()
      const next = { ...layoutRef.current, sizes: { ...layoutRef.current.sizes, [id]: { w: start.w, h: start.h } } }
      layoutRef.current = next
      setLayout(next)
    }
    const keyCancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel() } }
    pointerCleanup.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', keyCancel)
  }

  // ── drag to reorder (grab anywhere on the card) ──
  const dropIndexAt = (dragId: string, px: number, py: number): number => {
    const ids = layoutRef.current.order.filter((x) => x !== dragId)
    for (let i = 0; i < ids.length; i++) {
      const el = cellRefs.current.get(ids[i])
      if (!el) continue
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      if (py < cy || (py < r.bottom && px < cx)) return i
    }
    return ids.length
  }

  const onDragDown = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || writeLock.current || uncertain || pointerCleanup.current) return
    e.preventDefault()
    const el = cellRefs.current.get(id)
    if (!el) return
    const r = el.getBoundingClientRect()
    const startIndex = layoutRef.current.order.indexOf(id)
    let current: DragState = {
      id,
      px: e.clientX,
      py: e.clientY,
      gx: e.clientX - r.left,
      gy: e.clientY - r.top,
      w: r.width,
      h: r.height,
      dropIndex: startIndex,
    }
    setDrag(current)
    setPointerBusy(true)

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const dropIndex = dropIndexAt(id, ev.clientX, ev.clientY)
      current = { ...current, px: ev.clientX, py: ev.clientY, dropIndex }
      setDrag(current)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', keyCancel)
      pointerCleanup.current = null
      if (mounted.current) setPointerBusy(false)
    }
    const finish = () => {
      setDrag(null)
      requestAnimationFrame(() => { if (mounted.current) cellRefs.current.get(id)?.querySelector<HTMLButtonElement>('[data-grid-move]')?.focus() })
    }
    const up = () => {
      cleanup()
      const previous = layoutRef.current
      const order = previous.order.filter(value => value !== id)
      order.splice(current.dropIndex, 0, id)
      const next = { ...previous, order }
      layoutRef.current = next
      setLayout(next)
      finish()
      void persist(next)
    }
    const cancel = () => { cleanup(); finish() }
    const keyCancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel() } }
    pointerCleanup.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', keyCancel)
  }

  // board summary — what this report holds and watches, derived from the widgets on it
  const shownIds = layout.order.filter((id) => byId.has(id))
  const monitoredCount = shownIds.filter((id) => byId.get(id)!.monitor).length
  const anomalyCount = shownIds.filter((id) => {
    const m = byId.get(id)!.monitor
    return !!m && m.enabled && m.status === 'firing'
  }).length

  // render order: while dragging, move the dragged item to its drop slot so the rest reflow
  const renderOrder = drag
    ? (() => {
        const o = layout.order.filter((x) => x !== drag.id)
        o.splice(drag.dropIndex, 0, drag.id)
        return o
      })()
    : layout.order

  return (
    <div className={s.wrap}>
      <div className={s.toolbar} data-editing={editing}>
        {editing ? (
          <p className={s.hintRow}>
            <span className={s.editTag} aria-hidden>{t('grid.editLayout')}</span>
            <span id={instructionsId} className={s.hint}>{t('grid.dragHint')}</span>
          </p>
        ) : shownIds.length > 0 ? (
          <p className={s.summary}>
            <span>{t('grid.summaryWidgets', { count: shownIds.length })}</span>
            {monitoredCount > 0 && <span>{t('grid.summaryMonitored', { count: monitoredCount })}</span>}
            {anomalyCount > 0 && <span className={s.summaryAlert}><span className={s.summaryDot} aria-hidden />{t('grid.summaryAnomalies', { count: anomalyCount })}</span>}
          </p>
        ) : null}
        {editing && (
          <button type="button" className={`${s.btn} ${s.btnGhost}`} disabled={locked || !!drag} onClick={reset}>
            {t('grid.reset')}
          </button>
        )}
        <button
          ref={layoutToggle}
          type="button"
          disabled={writeBusy || pointerBusy}
          className={`${s.btn}${editing ? ` ${s.btnActive}` : ''}`}
          onClick={() => {
            setMenuOpenId(null) // editing hides the ⋯ menu; drop any open state so it doesn't reopen on exit
            setEditing((v) => !v)
          }}
          aria-pressed={editing}
        >
          {editing ? (
            t('grid.done')
          ) : (
            <>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
                <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <rect x="2.5" y="9" width="11" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              {t('grid.editLayout')}
            </>
          )}
        </button>
      </div>
      {layoutNotice && <p className={s.notice} role={layoutNotice === 'failed' || layoutNotice === 'unknown' ? 'alert' : 'status'}>
        {t(`grid.layout${layoutNotice[0].toUpperCase()}${layoutNotice.slice(1)}`)}
        {layoutNotice === 'failed' && <button type="button" className={s.btn} disabled={locked} onClick={() => void persist(layoutRef.current)}>{t('grid.retryLayout')}</button>}
      </p>}
      {uncertain && <p className={s.notice} role="alert">{t('grid.changeUnknown')} <button type="button" className={s.btn} onClick={() => window.location.reload()}>{t('grid.review')}</button></p>}
      <p className={s.srOnly} role="status">{announcement}</p>

      <div className={s.board} data-editing={editing}>
      <div className={`${s.grid}${editing ? ` ${s.editing}` : ''}`} ref={gridRef}>
        {renderOrder.map((id, index) => {
          const w = byId.get(id)
          if (!w) return null
          const size = layout.sizes[id]
          const span = { gridColumn: `span ${size.w}`, gridRow: `span ${size.h}` }

          if (drag && id === drag.id) {
            // the dragged card's slot becomes a drop placeholder
            return <div key={id} className={s.placeholder} style={span} aria-hidden />
          }

          return (
            <div
              key={id}
              data-grid-id={id}
              className={s.cell}
              // raise the cell whose ⋯ menu is open so the dropdown paints above the row below
              style={menuOpenId === id ? { ...span, zIndex: 40 } : span}
              ref={(el) => {
                if (el) cellRefs.current.set(id, el)
                else cellRefs.current.delete(id)
              }}
            >
              <div className={s.widgetWrap} inert={editing}>
                <WidgetRenderer
                  spec={w.spec}
                  data={w.data}
                  state={w.error ? 'error' : undefined}
                  fill
                  source={w.source}
                  menu={editing ? null : debugMenu(id)}
                  footer={editing || !w.monitor ? undefined : <MonitorFooter widget={w} />}
                />
              </div>

              {editing && (
                <>
                  <span className={s.handle} aria-hidden>
                    <svg viewBox="0 0 10 16" width="8" height="13" fill="currentColor">
                      <circle cx="2" cy="2" r="1.3" /><circle cx="8" cy="2" r="1.3" />
                      <circle cx="2" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" />
                      <circle cx="2" cy="14" r="1.3" /><circle cx="8" cy="14" r="1.3" />
                    </svg>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <span className={s.handleSize}>{size.w}×{size.h}</span>
                  </span>
                  <button type="button" data-grid-move className={s.dragSurface} onPointerDown={onDragDown(id)} onKeyDown={keyboardLayout(id, false)} aria-disabled={locked} aria-describedby={instructionsId} aria-label={`${t('grid.moveWidget')}: ${w.spec.title || t('grid.untitled')}`} />
                  <button type="button" className={s.resizeHandle} onPointerDown={onResizeDown(id)} onKeyDown={keyboardLayout(id, true)} aria-disabled={locked} aria-describedby={instructionsId} aria-label={`${t('grid.resizeWidget')}: ${w.spec.title || t('grid.untitled')}`}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
                      <path d="M14 6L6 14M14 11l-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                  {onUpdateWidget && editMeta?.[id] && (
                    <button
                      type="button"
                      disabled={locked}
                      className={s.editAction}
                      data-offset={onRemoveWidget ? 'second' : undefined}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => openEditor(id)}
                      aria-label={t('grid.editWidget')}
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
                        <path d="M3 13l2.6-.6 7-7-2-2-7 7L3 13zM9.3 4.7l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                  {onRemoveWidget && (
                    <button
                      type="button"
                      disabled={locked}
                      className={`${s.editAction} ${s.editRemove}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={event => { removeTrigger.current = event.currentTarget; setRemoveError(null); setRemoveId(id) }}
                      aria-label={t('grid.removeWidget')}
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden>
                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
      </div>

      {removeId && <BaseModal open onClose={() => { if (!writeLock.current) setRemoveId(null) }}
        title={t('grid.removeWidget')} description={t('grid.removeConfirm')} closeDisabled={writeBusy}
        onCloseAutoFocus={event => {
          event.preventDefault()
          const opener = removeTrigger.current
          if (opener?.isConnected && !opener.disabled) opener.focus()
          else layoutToggle.current?.focus()
        }}
        footer={<>
          <ModalButton variant="ghost" disabled={writeBusy} onClick={() => setRemoveId(null)}>{t('grid.cancel')}</ModalButton>
          {removeError === 'unknown'
            ? <ModalButton onClick={() => window.location.reload()}>{t('grid.review')}</ModalButton>
            : <ModalButton variant="destructive" disabled={locked} onClick={() => void removeWidget()}>{writeBusy ? t('grid.removing') : t('grid.removeWidget')}</ModalButton>}
        </>}>
        <p className={s.targetTitle}>{byId.get(removeId)?.spec.title || t('grid.untitled')}</p>
        {removeError && <p className={s.notice} role="alert">{t(removeError === 'unknown' ? 'grid.changeUnknown' : 'grid.removeFailed')}</p>}
      </BaseModal>}

      {editorId && (
        <BaseModal open onClose={() => { if (!editorBusy) setEditorId(null) }} title={t('grid.editorTitle')} size="xl" showCloseButton={!editorBusy}
          footer={<>
            <ModalButton variant="ghost" disabled={editorBusy} onClick={() => setEditorId(null)}>{t('grid.cancel')}</ModalButton>
            {uncertain ? <ModalButton onClick={() => window.location.reload()}>{t('grid.review')}</ModalButton> : <ModalButton disabled={editorBusy} onClick={saveEditor}>{editorBusy ? t('grid.saving') : t('grid.save')}</ModalButton>}
          </>}>
          <div style={{ display: 'grid', gap: 18 }}>
            <TextField label={t('grid.fieldTitle')} value={editorForm.title} disabled={editorBusy}
              onChange={(e) => setEditorForm((f) => ({ ...f, title: e.target.value }))} />
            {editMeta?.[editorId]?.sql !== null && (
              <TextAreaField label={t('grid.fieldSql')} value={editorForm.sql} disabled={editorBusy}
                className="min-h-[120px]" onChange={(e) => setEditorForm((f) => ({ ...f, sql: e.target.value }))} />
            )}
            <TextField label={t('grid.fieldRefresh')} inputMode="numeric" value={editorForm.refresh} disabled={editorBusy}
              hint={t('grid.refreshHint')} placeholder={t('grid.refreshPlaceholder')}
              onChange={(e) => setEditorForm((f) => ({ ...f, refresh: e.target.value }))} />
            {editorError && <p role="alert" className={s.editorError}>{editorError}</p>}
          </div>
        </BaseModal>
      )}

      {debugId && (
        <BaseModal open onClose={() => setDebugId(null)} title={t('debug.title')} size="xl" onCloseAutoFocus={event => {
          if (menuTrigger.current?.isConnected) { event.preventDefault(); menuTrigger.current.focus() }
        }}>
          <div className={s.debug}>
            <span className="dx-badge" style={{ justifySelf: 'start' }}>admin</span>
            {(debugMeta?.title || debugWidget?.spec.title) && (
              <div className={s.debugTitle}>{debugMeta?.title || debugWidget?.spec.title}</div>
            )}

            <div className={s.debugBlock}>
              <div className={s.debugHead}>
                <span className={s.debugLabel}>{t('debug.sql')}</span>
                {debugMeta?.sql && (
                  <button type="button" className={`${s.btn} ${s.btnGhost}`} aria-disabled={copyState === 'pending'} onClick={() => copySql(debugMeta.sql as string)}>
                    {copyState === 'pending' ? t('debug.copying') : copyState === 'copied' ? t('debug.copied') : t('debug.copy')}
                  </button>
                )}
              </div>
              {copyState !== 'idle' && <p className={s.notice} role={copyState === 'failed' ? 'alert' : 'status'}>{t(copyState === 'failed' ? 'debug.copyFailed' : copyState === 'pending' ? 'debug.copying' : 'debug.copied')}</p>}
              {debugMeta?.sql ? (
                <pre tabIndex={0} role="region" aria-label={t('debug.sql')} className={s.sqlRegion}>
                  {debugMeta.sql}
                </pre>
              ) : (
                <p className={s.debugEmpty}>{t('debug.noSql')}</p>
              )}
            </div>

            <dl className={s.debugMeta}>
              {debugWidget?.spec.type && (
                <div>
                  <dt>{t('debug.chartType')}</dt>
                  <dd>{debugWidget.spec.type}</dd>
                </div>
              )}
              <div>
                <dt>{t('debug.refresh')}</dt>
                <dd>{debugMeta?.refreshInterval ? t('debug.seconds', { count: debugMeta.refreshInterval }) : t('debug.manual')}</dd>
              </div>
              {debugWidget?.data && (
                <div>
                  <dt>{t('debug.rows')}</dt>
                  <dd>
                    {debugWidget.data.rows.length}
                    {debugWidget.data.truncated ? '+' : ''}
                  </dd>
                </div>
              )}
            </dl>

            <div className={s.debugActions}>
              <button type="button" className={s.btn} onClick={() => setDebugId(null)}>
                {t('debug.close')}
              </button>
            </div>
          </div>
        </BaseModal>
      )}

      {drag && (
        <div
          className={s.ghost}
          style={{ left: drag.px - drag.gx, top: drag.py - drag.gy, width: drag.w, height: Math.min(drag.h, 96) }}
        >
          <span className={s.ghostTitle}>{byId.get(drag.id)?.spec.title}</span>
        </div>
      )}
    </div>
  )
}
