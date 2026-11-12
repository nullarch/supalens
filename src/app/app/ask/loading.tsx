import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel } from '@/components/dashboard/Skeleton'
import s from './ask.module.css'

/**
 * Streamed while `/app/ask` server-renders (auth + org/demo provisioning + the data-source
 * queries). Mirrors the empty chat: the top bar's history button, then the centered greeting,
 * the rounded composer and the starter prompt cards.
 */
export default function AskLoading() {
  return (
    <LoadingFrame>
      <div className={s.loadingAsk}>
        <div className={s.loadingMasthead}>
          <Skel w={84} h={36} r={10} />
        </div>
        <div className={s.loadingWelcome}>
          <Skel w={360} h={36} r={8} style={{ maxWidth: '80%' }} />
          <Skel h={104} r={28} style={{ width: '100%' }} />
          <div className={s.loadingRows}>
            {[0, 1, 2].map((i) => (
              <Skel key={i} h={56} r={16} />
            ))}
          </div>
        </div>
      </div>
    </LoadingFrame>
  )
}
