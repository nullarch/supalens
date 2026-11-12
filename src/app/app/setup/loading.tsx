import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel } from '@/components/dashboard/Skeleton'
import s from './setup.module.css'

/**
 * Streamed while /app/setup resolves the org's activation state (counts across 6 tables).
 * Mirrors the flow: serif title row, the segmented stage rail, one stage card of divided rows.
 */
export default function SetupLoading() {
  return (
    <LoadingFrame>
      <div className={s.flow}>
        <div className={`dx-page-head ${s.head}`}>
          <div>
            <Skel h={28} r={8} style={{ width: 'min(420px, 85%)' }} />
            <Skel h={14} r={4} style={{ marginTop: 10, width: 'min(280px, 60%)' }} />
          </div>
        </div>
        <div className={s.rail}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={s.railItem} data-state={i === 0 ? 'current' : 'todo'}>
              <Skel w={i === 0 ? 72 : 56} h={12} r={4} />
            </div>
          ))}
        </div>
        <div className={s.card}>
          <div className={s.cardHead}>
            <Skel w={90} h={12} r={4} />
            <Skel h={18} r={6} style={{ marginTop: 10, width: 'min(320px, 75%)' }} />
            <Skel h={13} r={4} style={{ marginTop: 10, width: 'min(480px, 90%)' }} />
          </div>
          <div className={s.rows}>
            {[0, 1].map((i) => (
              <div key={i} className={s.stepRow}>
                <Skel w={18} h={18} r={999} />
                <Skel h={13} r={4} style={{ width: i === 0 ? 'min(220px, 60%)' : 'min(280px, 70%)' }} />
              </div>
            ))}
          </div>
          <div className={s.foot}>
            <Skel w={160} h={36} r={10} />
          </div>
        </div>
      </div>
    </LoadingFrame>
  )
}
