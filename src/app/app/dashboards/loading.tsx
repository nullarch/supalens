import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead } from "@/components/dashboard/Skeleton";
import s from "./overview.module.css";

/** Streamed while the Reports index lists the org's boards — the title row, then the table
 *  shell with a tinted head row and a few report rows (name, slug, row actions). */
export default function ReportsLoading() {
  return (
    <LoadingFrame>
      {/* matches the list's wide container */}
      <div data-page-width="wide">
      <SkelPageHead />
      <section className={s.library}>
        <div className={s.listHead}><Skel w={88} h={12} r={4} /></div>
        {[220, 320, 180].map((width, i) => (
          <div key={i} className={s.skelRow}>
            <Skel h={14} r={5} style={{ width: `min(${width}px, 70%)` }} />
            <Skel w={140} h={28} r={8} />
          </div>
        ))}
      </section>
      </div>
    </LoadingFrame>
  );
}
