import type { CSSProperties, ReactNode } from "react";
import s from "./Skeleton.module.css";

type Dim = number | string;

/**
 * Shimmer placeholder blocks for route-level `loading.tsx` skeletons.
 *
 * Pure presentational (no client hooks), so they compose into the server
 * `loading.tsx` files Next.js streams while a `/app/*` server component resolves.
 * Everything styles off the `.dx-*` utilities + global tokens (already loaded by
 * the `/app` layout), so a skeleton mirrors the real content 1:1.
 *
 * A skeleton renders inside the shell content area (the sidebar/topbar stay
 * mounted across intra-`/app` navigation), so shape the CONTENT only — never a
 * fake sidebar.
 */
export function Skel({
  w,
  h = 14,
  r,
  className,
  style,
}: {
  w?: Dim;
  h?: Dim;
  r?: Dim;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`${s.skel} ${className ?? ""}`}
      style={{ width: w, height: h, borderRadius: r, ...style }}
      aria-hidden
    />
  );
}

/** `PageHead`-shaped skeleton (title + subtitle bars) matching the `.dx-page-head` rhythm. */
export function SkelPageHead({ sub = true }: { sub?: boolean }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <Skel w={76} h={20} r={8} />
      <Skel w={260} h={40} r={10} style={{ marginTop: 16, maxWidth: "70%" }} />
      {sub && <Skel h={16} r={6} style={{ marginTop: 16, width: "min(420px, 70%)" }} />}
    </div>
  );
}

/** A `.dx-card`-wrapped `.dx-table` skeleton — reuses the real table chrome so borders/padding match. */
export function SkelTable({ cols = 4, rows = 6 }: { cols?: number; rows?: number }) {
  return (
    <section className={`dx-card ${s.table}`} aria-hidden="true">
      <table className="dx-table" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}>
                <Skel w={i === 0 ? 110 : 64} h={11} r={4} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <Skel w={c === 0 ? "72%" : c === cols - 1 ? 56 : "46%"} h={13} r={5} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Responsive content placeholders; never reserve fixed multi-column mobile grids. */
export function SkelGrid({ children, columns = 3, style }: { children: ReactNode; columns?: 2 | 3 | 4; style?: CSSProperties }) {
  return <div className={s.grid} data-columns={columns} style={style}>{children}</div>
}
