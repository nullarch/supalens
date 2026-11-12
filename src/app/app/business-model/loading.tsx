import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead } from "@/components/dashboard/Skeleton";
import s from "./business-model.module.css";

/**
 * Streamed while /app/business-model server-renders (3 table reads + one Markdown parse per
 * source). Mirrors the divided source rows, using the real row classes.
 */
export default function BusinessModelLoading() {
  return (
    <LoadingFrame>
      <SkelPageHead />
      <ul className={s.sources}>
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i}>
            <div className={s.source}>
              <span className={s.sourceMain}>
                <Skel w="58%" h={16} r={5} />
                <Skel w="46%" h={11} r={4} />
              </span>
              <span className={s.sourceCounts}>
                <Skel w={180} h={11} r={4} />
              </span>
              <span className={s.sourceState}>
                <Skel w={78} h={14} r={5} />
              </span>
              <span className={s.sourceTier}>
                <Skel w={86} h={20} r={8} />
              </span>
              <span className={s.sourceArrow}>
                <Skel w={14} h={14} r={4} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </LoadingFrame>
  );
}
