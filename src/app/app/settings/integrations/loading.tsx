import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead } from "@/components/dashboard/Skeleton";
import s from './integrations.module.css'

/**
 * Streamed while `/app/settings/integrations` loads (3 table reads plus a live
 * Slack `conversations.list` when a workspace is connected). Mirrors the page:
 * title, then per group a title over provider cards — the one-line head (tile,
 * name + pill, purpose, action) with a connected account bar and rows under it.
 */
export default function IntegrationsLoading() {
  return (
    <LoadingFrame>
      <SkelPageHead />
      <div className={s.page}>
        {[2, 1, 1].map((cards, g) => (
          <div key={g} className={s.group}>
            <Skel w={80} h={20} r={6} style={{ marginBottom: 12 }} />
            <div className={s.cards}>
              {Array.from({ length: cards }).map((_, i) => (
                <div key={i} className={s.provider}>
                  <div className={s.providerHead}>
                    <Skel w={40} h={40} r={12} />
                    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                      {/* min(): the provider head is tile + name + button, which does not fit 140px of name at 320px */}
                      <Skel h={18} r={6} style={{ width: "min(140px, 100%)" }} />
                      <Skel w="70%" h={12} r={5} />
                    </div>
                    <Skel w={128} h={36} r={10} />
                  </div>
                  {g === 0 && i === 0 && (
                    <div className={s.account}>
                      <div className={s.accountBar}><Skel w={180} h={16} r={5} /></div>
                      {[0, 1].map((row) => (
                        <div key={row} className={s.item}><Skel w={26} h={26} r={8} /><Skel w="40%" h={14} r={5} /></div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}
