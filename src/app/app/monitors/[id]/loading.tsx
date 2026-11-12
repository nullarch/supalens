import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead, SkelGrid } from '@/components/dashboard/Skeleton'

/** Streamed for /app/monitors/[id]: back link, title row, four stat cards, then evidence beside settings. */
export default function MonitorDetailLoading() {
  return (
    <LoadingFrame style={{ width: '100%' }}>
      <Skel w={96} h={14} r={4} style={{ marginBottom: 14 }} />
      <SkelPageHead />
      <SkelGrid columns={4} style={{ gap: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="dx-kpi" style={{ padding: '20px 22px' }}>
            <Skel w={90} h={12} r={4} />
            <Skel w="55%" h={i < 2 ? 28 : 16} r={6} style={{ marginTop: 12 }} />
          </div>
        ))}
      </SkelGrid>
      <SkelGrid columns={2} style={{ marginTop: 48, gap: 24 }}>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i}>
            <Skel w={150} h={18} r={6} style={{ marginBottom: 16 }} />
            <section className="dx-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Skel w="90%" h={12} r={4} />
              <Skel w="70%" h={12} r={4} />
              <Skel w="50%" h={12} r={4} />
            </section>
          </div>
        ))}
      </SkelGrid>
    </LoadingFrame>
  )
}
