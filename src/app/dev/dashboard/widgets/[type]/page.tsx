import Link from 'next/link'
import { notFound } from 'next/navigation'
import { WidgetRenderer } from '@/components/dashboard/widgets'
import { byKey } from '@/components/dashboard/widgets/__fixtures__/samples'
import s from '../gallery.module.css'
import { sampleProps, WIDGET_MODES } from '../sample-props'

export default async function WidgetFocusPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { type } = await params
  const { mode = 'ready' } = await searchParams
  if (!(WIDGET_MODES as readonly string[]).includes(mode)) notFound()
  const sample = byKey(type)
  if (!sample) notFound()

  const preview = sampleProps(sample, mode)

  return (
    <div className={s.page}>
      <header className={s.focusHead}>
        <Link href="/dev/dashboard/widgets" className={s.back}>
          ← 갤러리로
        </Link>
        <span className={s.eyebrow} style={{ display: 'block', marginTop: 14 }}>
          {sample.group} · {sample.spec.type}
        </span>
        <h1 className={s.title}>{sample.label}</h1>
      </header>

      <div className={s.focusGrid}>
        <div className={preview.fill ? s.fillHost : undefined}>
          <WidgetRenderer {...preview} span={1} />
        </div>
        <div>
          <div className={s.codeCap}>ChartSpec (agent가 방출)</div>
          <pre className={s.code}>{JSON.stringify(preview.spec, null, 2)}</pre>
          <div className={s.codeCap}>WidgetData (execute_sql 결과)</div>
          <pre className={s.code}>{JSON.stringify(preview.data, null, 2)}</pre>
        </div>
      </div>
    </div>
  )
}
