import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead, SkelTable } from '@/components/dashboard/Skeleton'

/**
 * The queue itself moved into /app/monitors (?view=incidents) and this route is now only the
 * redirect that keeps old links working — but the segment keeps a fallback (one `loading.tsx` per
 * route) and it stays queue-shaped, since the queue is exactly where the redirect lands: title row,
 * toolbar (segmented filter left, display zone right) and the table shell, in the same wide
 * container, so the hand-off doesn't jump.
 */
export default function IncidentsLoading() {
  return (
    <div data-page-width="wide">
      <LoadingFrame>
        <SkelPageHead />
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Skel w="min(440px, 100%)" h={39} r={12} />
          <Skel w={200} h={14} r={4} />
        </div>
        <SkelTable cols={7} rows={5} />
      </LoadingFrame>
    </div>
  )
}
