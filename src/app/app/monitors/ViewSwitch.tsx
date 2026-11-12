import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { MONITORS_VIEWS, monitorsViewHref, type MonitorsView } from './view'
import s from './view-switch.module.css'

/**
 * The 감시 screen's view switch: /app/monitors renders either the monitors list or the incidents
 * queue, and this picks which. Labels reuse the sidebar's nav strings (`appChrome.nav.*`) so the
 * switch reads the same as the navigation that leads here, and each segment carries the count its
 * view already computes — the number of monitors, and the incidents that are not resolved yet
 * (the queue's own default filter), toned negative when there are any.
 */
export async function ViewSwitch({
  view,
  counts,
}: {
  view: MonitorsView
  counts: Record<MonitorsView, number>
}) {
  const t = await getTranslations('appMonitors')
  const chrome = await getTranslations('appChrome')

  return (
    <nav className={`dx-segmented ${s.switch}`} aria-label={t('viewSwitch.aria')} data-monitors-view-switch>
      {MONITORS_VIEWS.map((v) => (
        <Link
          key={v}
          href={monitorsViewHref(v)}
          data-active={v === view}
          data-view={v}
          aria-current={v === view ? 'page' : undefined}
        >
          {chrome(v === 'incidents' ? 'nav.incidents' : 'nav.monitors')}
          <span className={s.count} data-tone={v === 'incidents' && counts.incidents > 0 ? 'negative' : undefined}>
            {counts[v]}
          </span>
        </Link>
      ))}
    </nav>
  )
}
