import { notFound } from 'next/navigation'

import '@/components/landing/editorial/editorial.css'
import { editorialFontVariables } from '@/components/landing/editorial/fonts'
import Header from '@/components/landing/editorial/Header'
import ReportView from '@/app/[locale]/x/[owner]/[repo]/ReportView'
import { ScanPanel } from '@/app/[locale]/x/[owner]/[repo]/ScanView'
import s from '@/app/[locale]/x/[owner]/[repo]/report.module.css'
import { reduceScanEvents } from '@/lib/xray/events'
import { DAILYCART_EVENTS, DAILYCART_REPORT } from '@/lib/xray/__fixtures__/dailycart'

// Dev-only preview of the /x report and scan views with the dailycart fixture (no DB, no
// Trigger). ?view=report|scan|failed · ?n=<events> replays the scan up to that many events.
// notFound() in production, same as the other /dev galleries.
export default async function XrayPreview({ searchParams }: { searchParams: Promise<{ view?: string; n?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { view = 'report', n } = await searchParams
  const count = Math.max(0, Math.min(DAILYCART_EVENTS.length, Number(n ?? DAILYCART_EVENTS.length)))
  const state = reduceScanEvents(DAILYCART_EVENTS.slice(0, count))

  return (
    <main className={`ed ${editorialFontVariables} ${s.page}`}>
      <Header sectionBase="/" />
      {view === 'report' ? (
        <ReportView
          model={{
            owner: 'dailycart',
            repo: 'app',
            fullName: 'dailycart/app',
            defaultBranch: 'main',
            commitSha: 'a1f3c9e2b7d04e51c9a8f0b2e6d4c3a1f9e8d7c6',
            completedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
            report: DAILYCART_REPORT,
          }}
          pageUrl="https://www.supalens.ai/x/dailycart/app"
          cardUrl="#"
        />
      ) : (
        <ScanPanel
          fullName="dailycart/app"
          branch="main"
          phase={view === 'failed' ? 'failed' : 'running'}
          errorCode={view === 'failed' ? 'clone_failed' : null}
          state={state}
        />
      )}
    </main>
  )
}
