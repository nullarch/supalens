import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead } from "@/components/dashboard/Skeleton";

/**
 * Generic `/app/*` loading fallback — the boundary Next streams while the app
 * SHELL (`/app/layout` → AppChrome: auth + org + billing) resolves, and the
 * per-route loading state for the few routes without their own `loading.tsx`
 * (dashboards index, invite). A neutral title row + stat-card skeleton in the
 * product's card anatomy (serif title, then white 16px cards with a label, a
 * figure and a muted line), NOT a spinner, so it speaks the same visual language as every
 * route skeleton — a cross-boundary entry (e.g. landing → /app/sources) reads as
 * skeleton→skeleton. Shapes the CONTENT only (the shell lives in the layout,
 * above this boundary) — never a fake navigation.
 */
export default function AppLoading() {
  return (
    <LoadingFrame>
      <SkelPageHead />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
          gap: 12,
        }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="dx-card"
            style={{ minHeight: 148, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 10 }}
          >
            <Skel w="46%" h={14} r={5} />
            <Skel w="34%" h={28} r={8} />
            <Skel w="72%" h={12} r={5} style={{ marginTop: "auto" }} />
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}
