import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead } from "@/components/dashboard/Skeleton";
import s from "../business-model.module.css";

/**
 * Streamed while /app/business-model/[sourceId] server-renders (source + context + KPI catalog,
 * then one Markdown parse). Mirrors the underline tabs over the overview and the entity map.
 */
export default function BusinessModelDetailLoading() {
  return (
    <LoadingFrame>
      <Skel w={120} h={14} r={5} style={{ marginBottom: 18 }} />
      <SkelPageHead />
      <div className={s.tabs}>
        {[72, 58, 64, 70, 128].map((w, i) => (
          <span key={i} className={s.tab} style={{ cursor: "default" }}>
            <Skel w={w} h={14} r={5} />
          </span>
        ))}
      </div>
      <div className={s.overview} style={{ display: "grid", gap: 10 }}>
        <Skel w="92%" h={15} r={5} />
        <Skel w="64%" h={15} r={5} />
      </div>
      <div className={s.entityCard}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "10px 28px",
              padding: "16px 22px",
              borderTop: i ? "1px solid var(--ax-line-soft, var(--line))" : undefined,
            }}
          >
            <Skel w={120} h={14} r={5} />
            <Skel w={110} h={20} r={8} />
            <Skel h={12} r={5} style={{ flex: "1 1 160px" }} />
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}
