import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { SkelPageHead, SkelTable } from '@/components/dashboard/Skeleton'
import s from '../ask.module.css'

/** Streamed while the paginated `agent_runs` history loads. Matches the full-column divided list. */
export default function AskHistoryLoading() {
  return (
    <LoadingFrame>
      <div className={s.loadingHistory}>
        <SkelPageHead />
        <SkelTable cols={3} rows={8} />
      </div>
    </LoadingFrame>
  )
}
