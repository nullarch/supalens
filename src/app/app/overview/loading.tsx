import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel } from '@/components/dashboard/Skeleton'
import s from './overview.module.css'

/**
 * Streamed while the overview server-renders (monitors, incidents, extractions, context docs).
 * Mirrors the report inbox: title → "Needs you" cards and the report log beside the service rail.
 */
export default function OverviewLoading() {
  const card = { border: '1px solid var(--line)', borderRadius: 'var(--r-card)', background: 'var(--paper-2)' }
  const report = (i: number) => (
    <div key={i} style={{ ...card, padding: '16px 20px' }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Skel w={64} h={20} r={999} />
        <Skel w={52} h={20} r={6} />
        <Skel w={96} h={20} r={6} />
      </div>
      <Skel w={i % 2 ? '52%' : '38%'} h={18} r={6} style={{ marginTop: 12 }} />
      <Skel w="70%" h={14} r={4} style={{ marginTop: 8 }} />
    </div>
  )
  return (
    // Same wide container as the overview it stands in for, so the layout doesn't jump on load.
    <div data-page-width="wide" className={s.page}>
      <LoadingFrame>
        <Skel w={140} h={34} r={8} />
        <Skel w={220} h={14} r={4} style={{ marginTop: 10, marginBottom: 28 }} />
        <div className={s.board}>
          <div style={{ display: 'grid', gap: 10 }}>
            <Skel w={120} h={22} r={6} style={{ marginBottom: 6 }} />
            {[0, 1].map(report)}
            <Skel w={120} h={22} r={6} style={{ marginTop: 30, marginBottom: 6 }} />
            {[2, 3, 4].map(report)}
          </div>
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            {[180, 110, 190].map((h, i) => (
              <div key={i} style={{ ...card, padding: '18px 20px', minHeight: h }}>
                <Skel w={90} h={14} r={4} />
                <Skel w="80%" h={14} r={4} style={{ marginTop: 16 }} />
                <Skel w="65%" h={14} r={4} style={{ marginTop: 12 }} />
              </div>
            ))}
          </div>
        </div>
      </LoadingFrame>
    </div>
  )
}
