import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel } from '@/components/dashboard/Skeleton'
import s from '../../ask.module.css'

/** Streamed while one past run's persisted answer + charts load. Matches the 768px reading column. */
export default function AskRunLoading() {
  return (
    <LoadingFrame>
      <div className={s.loadingRun}>
        <Skel w={140} h={14} r={5} />
        <Skel w="86%" h={34} r={8} />
        <Skel w={260} h={12} r={4} style={{ maxWidth: '70%' }} />
        <Skel h={64} r={12} style={{ width: '100%', marginTop: 8 }} />
        {['96%', '100%', '88%'].map((w) => (
          <Skel key={w} w={w} h={15} r={5} />
        ))}
        <div className={s.loadingFigures}>
          {[0, 1].map((i) => (
            <div key={i} className="dx-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Skel w={130} h={11} r={4} />
              <Skel h={160} r={8} style={{ width: '100%' }} />
            </div>
          ))}
        </div>
      </div>
    </LoadingFrame>
  )
}
