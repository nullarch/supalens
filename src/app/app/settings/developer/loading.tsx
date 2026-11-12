import { LoadingFrame } from '@/components/dashboard/LoadingFrame'
import { Skel, SkelPageHead } from "@/components/dashboard/Skeleton";

/** Streamed while `/app/settings/developer` loads the org's API keys. Mirrors the endpoint card
 *  (label + code field + copy) and the step cards (title row, then table or snippets). */
export default function DeveloperLoading() {
  // boxSizing: the 1px border would otherwise push the card 2px past its container at 320px.
  const card = { display: "grid", gap: 16, padding: "24px 28px", border: "1px solid var(--line)", borderRadius: 16, background: "var(--paper-2)", boxSizing: "border-box", minWidth: 0 } as const;
  return (
    <LoadingFrame>
      <SkelPageHead />
      <div style={{ display: "grid", gap: 16 }}>
        <div style={card}>
          <Skel w={110} h={14} r={5} />
          <Skel h={44} r={10} style={{ width: "100%" }} />
        </div>
        {[96, 132].map((h, i) => (
          <div key={i} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 8 }}>
                <Skel w={180} h={18} r={6} />
                <Skel w={260} h={12} r={5} style={{ maxWidth: "70vw" }} />
              </div>
              {i === 0 && <Skel w={150} h={40} r={10} />}
            </div>
            <Skel h={h} r={16} style={{ width: "100%" }} />
          </div>
        ))}
      </div>
    </LoadingFrame>
  );
}
