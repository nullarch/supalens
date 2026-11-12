import Link from 'next/link'
import { notFound } from 'next/navigation'
import { WidgetRenderer } from '@/components/dashboard/widgets'
import { GROUPS, SAMPLES } from '@/components/dashboard/widgets/__fixtures__/samples'
import s from './gallery.module.css'
import { sampleProps, WIDGET_MODES } from './sample-props'

export default async function WidgetGalleryPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'ready' } = await searchParams
  if (!(WIDGET_MODES as readonly string[]).includes(mode)) notFound()

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <span className={s.eyebrow}>Local design preview · sample data only</span>
          <h1 className={s.title}>Widget library</h1>
          <p className={s.sub}>
            Actual product components with sample specs and data. No database connection, query execution or account actions. Recorded times are fixed examples.
          </p>
        </div>
        <span className={s.count}>{SAMPLES.length} samples</span>
      </header>

      <nav className={s.nav}>
        {WIDGET_MODES.map(value => <Link key={value} href={`?mode=${value}`} className={s.navLink} aria-current={mode === value ? 'page' : undefined}>{value}</Link>)}
        {GROUPS.map((g, i) => (
          <a key={g} href={`#g${i}`} className={s.navLink}>
            {g}
          </a>
        ))}
      </nav>

      {GROUPS.map((group, gi) => {
        const items = SAMPLES.filter((sample) => sample.group === group)
        if (items.length === 0) return null
        return (
          <section key={group} id={`g${gi}`} className={s.group}>
            <div className={s.groupLabel}>{group}</div>
            <div className={s.grid}>
              {items.map((sample) => (
                <div key={sample.key} data-widget-sample={sample.key} className={`${s.item} ${sample.span === 2 ? s.wide : ''}`}>
                  <div className={s.itemHead}>
                    <span className={s.itemLabel}>{sample.label}</span>
                    <Link href={`/dev/dashboard/widgets/${sample.key}`} className={s.itemLink}>
                      {sample.spec.type} ↗
                    </Link>
                  </div>
                  <div className={mode === 'fill' || mode === 'references-fill' ? s.fillHost : undefined}><WidgetRenderer {...sampleProps(sample, mode)} span={1} /></div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
