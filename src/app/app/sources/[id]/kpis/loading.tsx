import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead } from "@/components/dashboard/Skeleton";
import css from "./kpis.module.css";

/** One proposal card: checkbox + title/meta/description/evidence + the framed widget preview. */
function SkelKpiCard() {
  return (
    <div className={css.card}>
      <span className={css.checkHit}>
        <Skel w={18} h={18} r={5} />
      </span>
      <div className={css.cardBody}>
        <div className={css.titleLine}>
          <Skel w="46%" h={17} r={5} />
        </div>
        <div className={css.metaLine}>
          <Skel w={150} h={11} r={4} />
        </div>
        <Skel w="72%" h={13} r={5} style={{ marginTop: 14 }} />
        <div className={css.evidence}>
          <Skel w={150} h={22} r={8} />
          <Skel w={220} h={22} r={8} />
        </div>
      </div>
      <div className={css.cardSide}>
        <div className={css.previewFrame}>
          <Skel h={132} r={9} />
          <Skel w="55%" h={11} r={4} style={{ margin: "12px 6px 4px" }} />
        </div>
      </div>
    </div>
  );
}

/** Streamed while the KPI review page loads its catalog + extraction + dashboards. */
export default function KpiReviewLoading() {
  return (
    <LoadingFrame>
      <Skel w={110} h={14} r={5} style={{ marginBottom: 18 }} />
      <SkelPageHead />
      <div className={css.approval}>
        <div className={css.figures}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={css.figure}>
              <Skel w={80} h={11} r={4} />
              <Skel w={34} h={34} r={8} style={{ marginTop: 12 }} />
            </div>
          ))}
        </div>
        <div className={css.plan} style={{ paddingBottom: 22 }}>
          <Skel w={210} h={22} r={6} />
          <Skel w="38%" h={14} r={5} style={{ marginTop: 18 }} />
          <Skel w="64%" h={14} r={5} style={{ marginTop: 22 }} />
        </div>
      </div>
      <div className={css.groups}>
        {[2, 1].map((rows, g) => (
          <div key={g} className={css.group}>
            <div className={css.groupHead}>
              <Skel w={140} h={26} r={6} />
            </div>
            <div className={css.board}>
              {Array.from({ length: rows }).map((_, i) => (
                <SkelKpiCard key={i} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}
