import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead } from "@/components/dashboard/Skeleton";

/** Streamed for /app/settings/notifications — its heaviest cost is the live Slack
 *  `conversations.list` call when a workspace is connected. Mirrors the destinations
 *  card: channel rows (icon, name and state on the left, configuration on the right). */
export default function NotificationsLoading() {
  return (
    <LoadingFrame style={{ width: "100%" }}>
      <SkelPageHead />
      <Skel w={120} h={18} r={6} style={{ marginBottom: 12 }} />
      <div style={{ overflow: "hidden", border: "1px solid var(--line)", borderRadius: 16, background: "var(--paper-2)" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "16px 40px",
              padding: "24px 28px",
              borderTop: i ? "1px solid var(--line)" : undefined,
            }}
          >
            <div style={{ display: "flex", gap: 12, flex: "0 1 17rem", minWidth: 0 }}>
              <Skel w={36} h={36} r={10} />
              <div style={{ display: "grid", gap: 10, flex: 1 }}>
                <Skel w={110} h={16} r={5} />
                <Skel w="90%" h={12} r={5} />
              </div>
            </div>
            <div style={{ display: "grid", gap: 10, flex: "1 1 280px", minWidth: 0 }}>
              <Skel w={90} h={14} r={5} />
              <Skel h={44} r={10} style={{ width: "100%" }} />
            </div>
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}
