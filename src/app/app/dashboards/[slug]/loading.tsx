import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelGrid } from "@/components/dashboard/Skeleton";
import s from "../overview.module.css";

/**
 * Streamed while `getDashboardBySlug` re-runs EVERY widget's live query (the
 * slowest `/app` route on a cold cache). Shapes the report — back link, serif title
 * row, the summary row and white widget cards (a stat pair plus taller chart
 * cards) — so the layout doesn't jump when data lands.
 */
export default function DashboardLoading() {
  return (
    <LoadingFrame>
      {/* the board renders at the wide container, so its skeleton has to as well */}
      <div data-page-width="wide">
      <div style={{ marginBottom: 24 }}>
        <Skel w={72} h={14} r={5} />
        <Skel w={300} h={30} r={8} style={{ marginTop: 14, maxWidth: "70%" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, minHeight: 36 }}>
        <Skel w={180} h={14} r={5} />
        <Skel w={116} h={36} r={10} />
      </div>
      <SkelGrid columns={2} style={{ gap: 16 }}>
        {[120, 120, 260, 260].map((h, i) => (
          <div key={i} className={s.skelCard}>
            <Skel w={i < 2 ? 110 : 160} h={14} r={5} />
            <Skel h={h - 40} r={8} style={{ width: "100%" }} />
          </div>
        ))}
      </SkelGrid>
      </div>
    </LoadingFrame>
  );
}
