import type { ContextState } from "./data";
import s from "./business-model.module.css";

/** Server- and client-safe presentational bits shared by the index and the detail tabs. */

const DOT: Record<ContextState, string> = {
  fresh: "dx-dot-ok",
  stale: "dx-dot-warning",
  generating: "dx-dot-sync",
  failed: "dx-dot-attention",
  none: "dx-dot-idle",
};

export function StateDot({ state, label }: { state: ContextState; label: string }) {
  return (
    <span className={s.state} data-state={state}>
      <span className={`dx-dot ${DOT[state]}`} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Provenance tag. Code-derived understanding carries the indigo tag (grounded in the product's own
 * code); a schema-only digest carries bloom — a machine reading that has not been grounded yet.
 */
export function TierChip({ label, tier }: { label: string; tier?: "repo" | "schema" | null }) {
  const tone = tier === "repo" ? "dx-badge-clay" : tier === "schema" ? "dx-badge-bloom" : "";
  return (
    <span className={`dx-badge ${tone} ${s.tier}`} data-tier={tier ?? undefined}>
      {label}
    </span>
  );
}

/**
 * Render a rule/entity string that still carries markdown backticks: identifiers become <code>,
 * everything else stays text. The parser deliberately preserves backticks for exactly this.
 */
export function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h14" />
      <path d="M13 7l5 5-5 5" />
    </svg>
  );
}

export function AlertIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 8v5" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
