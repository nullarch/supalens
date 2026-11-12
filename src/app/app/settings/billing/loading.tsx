import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead, SkelTable, SkelGrid } from "@/components/dashboard/Skeleton";

/**
 * Streamed while the billing page loads — its heaviest cost is a synchronous
 * `reconcileOrgSubscription` Paddle-API round-trip when Paddle is configured, so
 * a shaped skeleton matters. Mirrors the current-plan card (name, action, four
 * figure cells) and the usage card / payments table pair.
 */
export default function BillingLoading() {
  return (
    <LoadingFrame>
      <SkelPageHead />

      <section style={{ padding: "24px 28px", border: "1px solid var(--line)", borderRadius: 16, background: "var(--paper-2)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <Skel w={90} h={14} r={5} />
            <Skel w={140} h={30} r={8} />
            <Skel w={170} h={12} r={5} />
          </div>
          <Skel w={170} h={44} r={10} />
        </div>
        <SkelGrid columns={4} style={{ gap: 24, marginTop: 28 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ display: "grid", gap: 8 }}>
              <Skel w={80} h={14} r={5} />
              <Skel w={90} h={26} r={6} />
            </div>
          ))}
        </SkelGrid>
      </section>

      <SkelGrid columns={2} style={{ gap: 24, marginTop: 40 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <Skel w={150} h={18} r={6} />
          <div style={{ display: "grid", gap: 22, padding: 24, border: "1px solid var(--line)", borderRadius: 16, background: "var(--paper-2)" }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Skel w={90} h={13} r={5} />
                  <Skel w={60} h={16} r={5} />
                </div>
                <Skel h={4} r={999} style={{ width: "100%" }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <Skel w={150} h={18} r={6} />
          <SkelTable cols={3} rows={4} />
        </div>
      </SkelGrid>
    </LoadingFrame>
  );
}
