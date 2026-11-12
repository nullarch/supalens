'use client'

import type { ReactNode } from 'react'
import { useId, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BaseModal } from '@/components/modals/base-modal'
import { widgetTimestamp } from './presentation'
import DatabaseLogo from '@/components/brand/DatabaseLogo'
import type { WidgetSource } from '@/lib/dashboards/widget-source'
import s from './Widget.module.css'

export type WidgetState = 'ready' | 'loading' | 'empty' | 'error'

export interface WidgetProps {
  title?: string
  description?: string
  /** Last recorded refresh; displayed explicitly in UTC, not as a live freshness claim. */
  refreshedAt?: string | Date | null
  state?: WidgetState
  error?: string
  truncated?: boolean
  /** Optional functioning action slot; omitted means no menu. */
  menu?: ReactNode
  /** dashboard grid column span */
  span?: 1 | 2
  /** min body height (charts pass this so skeleton/empty reserve space → no CLS) */
  bodyHeight?: number
  /** tighten body padding for edge-to-edge charts */
  flush?: boolean
  /** fill the card to its container's height (dashboard grid cell) so charts reflow on resize */
  fill?: boolean
  /** strip pinned under the body (monitoring status on a report board); omitted elsewhere */
  footer?: ReactNode
  /** The service the widget reads from, named above the title on a dashboard board. `null` says
   *  the widget has no data source; omitted (anywhere outside a board) renders no line. */
  source?: WidgetSource | null
  children?: ReactNode
}

export function Widget({
  title,
  description,
  refreshedAt,
  state = 'ready',
  error,
  truncated,
  menu,
  span = 1,
  bodyHeight,
  flush,
  fill,
  footer,
  source,
  children,
}: WidgetProps) {
  const t = useTranslations('appDashboards')
  const titleId = useId()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsTrigger = useRef<HTMLButtonElement>(null)
  const recorded = widgetTimestamp(refreshedAt, useLocale())
  // The bodyHeight reserve exists for CLS-free lazy chart swaps in FLOW contexts (ask stream,
  // gallery, share). In `fill` mode the grid cell bounds the card — a min-height there defeats
  // the .fill shrink contract and pushes the chart/legend past the card border.
  // min-height is border-box, so include the body padding (flush 12+16 / default 16+24, see
  // Widget.module.css) — otherwise the loading/empty body is one padding shorter than the chart.
  const bodyStyle = bodyHeight && !fill ? { minHeight: bodyHeight + (flush ? 28 : 40) } : undefined

  // Which service this number belongs to: a mark tile + the source name, one quiet line above
  // the title (a board mixes every service in the workspace). Truncates; the full name is in
  // the tooltip and the details dialog.
  const sourceLine = source === undefined ? null : (
    <div className={s.source} data-widget-source data-none={source ? undefined : ''} title={source?.name}>
      <span className={s.sourceMark} aria-hidden>
        {source ? (
          <DatabaseLogo name={source.engine} size={14} />
        ) : (
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <ellipse cx="8" cy="4" rx="5" ry="2" />
            <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" strokeDasharray="2 2" />
          </svg>
        )}
      </span>
      <span className={s.sourceName}>
        {source ? <><span className={s.srOnly}>{t('widget.source')}: </span>{source.name}</> : t('widget.sourceNone')}
      </span>
    </div>
  )

  return (
    <section data-widget-card aria-labelledby={title ? titleId : undefined} className={`${s.card}${span === 2 ? ` ${s.span2}` : ''}${fill ? ` ${s.fill}` : ''}`}>
      {(title || description || menu || refreshedAt || sourceLine) && (
        <div className={s.head} data-widget-header>
          <div className={s.titleWrap}>
            {sourceLine}
            {title && <h3 id={titleId} className={s.title}>{title}</h3>}
            {description && <div className={s.desc}>{description}</div>}
            {refreshedAt && (
              <div className={s.refreshed}>{recorded
                ? <time dateTime={recorded.iso}>{t('widget.recordedAt', { time: recorded.label })}</time>
                : t('widget.timeUnavailable')}</div>
            )}
          </div>
          {(fill || menu) && <div className={s.headRight}>
            {fill && <button type="button" ref={detailsTrigger} className={s.detailsButton} aria-label={t('widget.details')} aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden><path d="M4 5.5h12M4 10h12M4 14.5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </button>}
            {menu}
          </div>}
        </div>
      )}

      {truncated && state === 'ready' && (
        <div className={s.truncated} role="note">
          <span className={s.truncatedDot} aria-hidden />
          {t('widget.truncated')}
        </div>
      )}

      <div data-widget-body className={`${s.body}${flush ? ` ${s.flush}` : ''}`} style={bodyStyle}
        tabIndex={fill ? 0 : undefined} role={fill ? 'group' : undefined} aria-label={fill ? t('widget.content') : undefined}>
        {state === 'loading' && (
          <div className={s.skeleton} aria-busy="true" role="status" aria-label={t('widget.loading')}>
            {bodyHeight ? (
              <div className={s.skelChart} />
            ) : (
              <>
                <div className={s.skelBar} style={{ width: '60%' }} />
                <div className={s.skelBar} style={{ width: '90%' }} />
                <div className={s.skelBar} style={{ width: '75%' }} />
              </>
            )}
          </div>
        )}

        {state === 'empty' && (
          <div className={s.state} role="status">
            {t('widget.empty')}
          </div>
        )}

        {state === 'error' && (
          <div className={`${s.state} ${s.errorState}`} role="alert">
            <span className={s.errorTitle}><span className={s.errorDot} aria-hidden />{t('widget.error')}</span>
            {error && <span className={s.errorMsg}>{error}</span>}
          </div>
        )}

        {state === 'ready' && children}
      </div>

      {footer && <div data-widget-footer className={s.footer} role="group" aria-label={t('widget.details')}>{footer}</div>}
      {fill && <BaseModal open={detailsOpen} onClose={() => setDetailsOpen(false)} title={t('widget.details')}
        onCloseAutoFocus={event => { event.preventDefault(); detailsTrigger.current?.focus() }}>
        <div className={s.fullDetails}>
          {sourceLine}
          {title && <h3 className={s.fullTitle}>{title}</h3>}
          {description && <p className={s.fullDesc}>{description}</p>}
          {refreshedAt && <p className={s.refreshed}>{recorded ? <time dateTime={recorded.iso}>{t('widget.recordedAt', { time: recorded.label })}</time> : t('widget.timeUnavailable')}</p>}
        </div>
      </BaseModal>}
    </section>
  )
}
