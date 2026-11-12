'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import LogoMark from '@/components/brand/LogoMark'
import { WidgetRenderer } from '@/components/dashboard/widgets'
import { WallpaperMesh } from './HeroDesktop'
import { buildBoardWidgets } from './showcase-fixtures'
import s from './Showcase.module.css'

/* Board layout (desktop): column span + cell height per widget. Widgets sharing
   a row get the SAME height so card bottoms align. Heights are sized to each
   widget's real content — a KPI card needs ~210px (header + value + delta), a
   chart needs a real plot height (too short and its axis labels overflow). */
const LAYOUT: Record<string, { col: number; h: number }> = {
  'kpi-revenue': { col: 6, h: 216 },
  'kpi-orders': { col: 6, h: 216 },
  'line-revenue': { col: 8, h: 340 },
  'table-products': { col: 4, h: 340 },
  'stacked-region': { col: 12, h: 300 },
}

/* Height of the operator status row rendered under every widget (verified ·
   monitoring · last check). Added to each cell's --h so the widget itself keeps
   the plot height it was sized for. */
const STATUS_H = 30

/**
 * The board demo renders the REAL widget library (src/components/dashboard/widgets)
 * from 데일리카트 sample data — same specs + {columns, rows} contract a live agent
 * answer streams. It's staged inside the SAME "supalens OS" desktop scene the hero
 * uses (shared WallpaperMesh + a frosted menu bar + one app window), so the board
 * reads as a real dashboard sitting on a PC — not a flat card. Recharts widgets are
 * next/dynamic ssr:false (registry.tsx) so this is a client component; the widgets
 * style off the GLOBAL css vars (globals.css) and flip in dark on their own, while
 * the desktop chrome uses .cx brand tokens.
 */
export default function Showcase() {
  const t = useTranslations('showcase')
  const boardWidgets = buildBoardWidgets({
    titles: {
      revenue: t('board.titles.revenue'),
      orders: t('board.titles.orders'),
      revenueTrend: t('board.titles.revenueTrend'),
      topProducts: t('board.titles.topProducts'),
      regionCategory: t('board.titles.regionCategory'),
    },
    vsYesterday: t('board.vsYesterday'),
    orderUnit: t('board.orderUnit'),
    tableCols: {
      product: t('board.tableCols.product'),
      revenue: t('board.tableCols.revenue'),
      orders: t('board.tableCols.orders'),
    },
    regions: t.raw('board.regions') as string[],
    categories: t.raw('board.categories') as string[],
    products: t.raw('board.products') as string[],
  })

  return (
    <section id="showcase" className={`cx-section ${s.section}`}>
      <div className="cx-container">
        <header className={s.head}>
          <h3 className="cx-type-md">{t('title')}</h3>
          <p className={`cx-type-md ${s.lede}`}>{t('lede')}</p>
          <Link className="cx-link" href="/app/dashboards">
            {t('exploreLink')} →
          </Link>
        </header>

        {/* the board on a depicted "supalens OS" desktop (aria-hidden chrome,
            real interactive-looking widgets inside) */}
        <div className={s.desktop}>
          <WallpaperMesh className={s.wall} />

          <div className={s.menubar} aria-hidden="true">
            <span className={s.mbBrand}>
              <LogoMark size={11} className={s.mbLens} />
              supalens
            </span>
            <span className={s.mbItem}>{t('menu.file')}</span>
            <span className={s.mbItem}>{t('menu.edit')}</span>
            <span className={s.mbItem}>{t('menu.view')}</span>
            <span className={s.mbItemWide}>{t('menu.go')}</span>
            <span className={s.mbItemWide}>{t('menu.window')}</span>
            <span className={s.mbRight}>{t('clock')}</span>
          </div>

          <div className={s.win}>
            <div className={s.chrome}>
              <span className={s.dots} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className={s.chromeTitle}>{t('windowTitle')}</span>
            </div>

            <div className={s.board}>
              {boardWidgets.map((w) => {
                const lay = LAYOUT[w.key] ?? { col: w.col, h: 320 }
                return (
                  <div
                    key={w.key}
                    className={s.cell}
                    style={{
                      ['--col' as string]: lay.col,
                      ['--h' as string]: `${lay.h + STATUS_H}px`,
                    }}
                  >
                    <div className={s.widgetWrap}>
                      <WidgetRenderer spec={w.spec} data={w.data} fill />
                    </div>
                    {/* operator status: monitoring state + last check, verified chip */}
                    <div className={s.status} aria-hidden="true">
                      <span
                        className={`${s.sDot} ${
                          w.status.monitoring === 'anomaly'
                            ? s.sDotAnomaly
                            : w.status.monitoring === 'normal'
                              ? s.sDotNormal
                              : s.sDotNone
                        }`}
                      />
                      <span className={s.sText}>
                        {w.status.monitoring === 'none'
                          ? t('status.dashboardOnly')
                          : w.status.monitoring === 'anomaly'
                            ? t('status.anomaly')
                            : t('status.monitoring')}
                        {w.status.checkedMin != null
                          ? ` · ${t('status.checked', { min: w.status.checkedMin })}`
                          : ''}
                      </span>
                      {w.status.verified && <span className={s.sVerified}>{t('status.verified')}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
