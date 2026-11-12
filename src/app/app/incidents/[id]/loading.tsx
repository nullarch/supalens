import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead, SkelGrid } from '@/components/dashboard/Skeleton'

/**
 * Streamed while one incident server-renders (event history + pairing + monitor join). Same wide
 * container as the detail it stands in for, so the layout doesn't jump on load.
 */
export default function IncidentDetailLoading() {
  return (
    <div data-page-width="wide">
      <LoadingFrame>
        <Skel w={96} h={14} r={4} style={{ marginBottom: 14 }} />
        <SkelPageHead />
        <SkelGrid columns={4} style={{ gap: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="dx-kpi" style={{ padding: '20px 22px' }}>
              <Skel w={100} h={12} r={4} />
              <Skel w="60%" h={28} r={6} style={{ marginTop: 12 }} />
            </div>
          ))}
        </SkelGrid>
        <SkelGrid columns={2} style={{ marginTop: 48, gap: 24 }}>
          <div>
            <Skel w={160} h={18} r={6} style={{ marginBottom: 16 }} />
            <Skel h={260} r="var(--r-card)" />
          </div>
          <div>
            <Skel w={180} h={18} r={6} style={{ marginBottom: 16 }} />
            <Skel h={200} r="var(--r-card)" />
          </div>
        </SkelGrid>
      </LoadingFrame>
    </div>
  )
}
