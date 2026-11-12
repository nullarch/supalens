import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel } from "@/components/dashboard/Skeleton";
import s from "./data-sources.module.css";

/**
 * Streamed while `/app/sources` server-renders (5 table reads + a per-source KPI/extraction
 * fan-out). It mirrors the real surface so nothing jumps when the page arrives: the wide
 * container, the head with its right-aligned action, then the card grid led by the pinned
 * connect tile — three across above 1360px, like the real board.
 *
 * The head is spelled out here rather than reusing SkelPageHead because that helper paints a
 * kicker bar, and `.dx-kicker` is `display: none` in this app — the real head is title + lede.
 */
export default function SourcesLoading() {
  return (
    <LoadingFrame>
      <div data-page-width="wide">
        <div className="dx-page-head">
          <div>
            <Skel w={148} h={35} r={8} />
            <Skel h={23} r={6} style={{ marginTop: 6, width: "min(430px, 78%)" }} />
          </div>
          <div className="dx-head-actions">
            <Skel w={104} h={32} r="var(--r-control)" />
          </div>
        </div>

        <div className={s.board}>
          {/* The pinned connect tile is always the grid's first cell, so the skeleton has it too. */}
          <div className={s.addCard} style={{ cursor: "default" }}>
            <Skel w={40} h={40} r="50%" />
            <Skel w={104} h={15} r={5} />
            <Skel w={96} h={22} r={999} />
          </div>

          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={s.source}>
              <div className={s.head}>
                <Skel w={40} h={40} r="var(--r-control)" />
                <div className={s.identity}>
                  <Skel w={i % 3 === 1 ? "52%" : "38%"} h={17} r={5} style={{ marginTop: 3 }} />
                  <Skel w="72%" h={12} r={4} style={{ marginTop: 9 }} />
                </div>
                <Skel w={24} h={24} r={8} style={{ margin: 6 }} />
              </div>
              <ul className={s.pipe}>
                {Array.from({ length: 5 }).map((__, c) => (
                  <li key={c}>
                    <div className={s.row}>
                      <Skel w={c === 1 ? 104 : 76} h={13} r={4} />
                      <Skel w={c === 1 ? 150 : 112} h={24} r={12} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className={s.foot}>
                <Skel w={i % 3 === 0 ? 96 : 116} h={32} r="var(--r-control)" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </LoadingFrame>
  );
}
