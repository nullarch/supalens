import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead, SkelTable } from '@/components/dashboard/Skeleton'

/**
 * Streamed while the 감시 screen server-renders — either view (/app/monitors and
 * /app/monitors?view=incidents are one route, and `loading.tsx` cannot read searchParams).
 *
 * So it mirrors only what BOTH views share: the view switch, the title row, the toolbar row
 * (segmented filter left, meta right) and the table shell, in the same wide container so the layout
 * doesn't jump on load. The monitors view's two-cell summary card is deliberately left out rather
 * than flashing a card the incidents queue never renders.
 */
export default function MonitorsLoading() {
  return (
    <div data-page-width="wide">
      <LoadingFrame>
        <Skel w={196} h={39} r={12} style={{ marginBottom: 20 }} />
        <SkelPageHead />
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Skel w="min(440px, 100%)" h={39} r={12} />
          <Skel w={200} h={14} r={4} />
        </div>
        <SkelTable cols={6} rows={5} />
      </LoadingFrame>
    </div>
  )
}
