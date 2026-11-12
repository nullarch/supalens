import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead, SkelTable } from "@/components/dashboard/Skeleton";

/** Streamed while the members + pending-invitations lists load. Mirrors PageHead, the
 *  lavender figure strip, the section head and the roster table. */
export default function MembersLoading() {
  return (
    <LoadingFrame>
      <SkelPageHead />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
          gap: 24,
          padding: "20px 24px 22px",
          marginBottom: 40,
          border: "1px solid var(--ax-line-soft)",
          borderRadius: "var(--r-panel)",
          background: "var(--ax-panel)",
        }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ display: "grid", gap: 12 }}>
            <Skel w={80} h={11} r={4} />
            <Skel w={48} h={32} r={8} />
          </div>
        ))}
      </div>
      <Skel w={120} h={22} r={6} style={{ marginBottom: 16 }} />
      <SkelTable cols={4} rows={4} />
    </LoadingFrame>
  );
}
