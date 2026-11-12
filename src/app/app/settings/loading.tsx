import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead } from "@/components/dashboard/Skeleton";
import s from "./settings.module.css";

/**
 * Streamed for `/app/settings` (and any settings subroute without its own
 * `loading.tsx`). Mirrors the stack of settings cards: a group label over white
 * cards with a title, a description, a control and a tinted foot.
 */
export default function SettingsLoading() {
  return (
    <LoadingFrame style={{ width: "100%" }}>
      <SkelPageHead />
      <div className={s.doc}>
        {[3, 2].map((cards, group) => (
          <div key={group} className={s.group}>
            <Skel w={96} h={14} r={5} />
            {Array.from({ length: cards }).map((_, i) => (
              <div key={i} className={s.card}>
                <div className={s.cardHead}>
                  <Skel w={160} h={18} r={6} />
                  <Skel w="60%" h={12} r={5} style={{ marginTop: 6 }} />
                </div>
                <div className={s.cardBody}>
                  <Skel h={44} r={10} style={{ width: "100%", maxWidth: 400 }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}
