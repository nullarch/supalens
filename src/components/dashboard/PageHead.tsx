import type { ReactNode } from "react";

/**
 * Standard `/app` page header — mono kicker tag, regular-weight serif title, lede,
 * and right-aligned actions (the editorial section heading, at product density).
 *
 * Styled entirely off the `.dx-*` utilities in `src/app/app/dashboard.css` (the
 * `/app` layout imports them once), so it is `/app`-scoped by design and must not
 * be used on the marketing surface.
 *
 * Slots:
 * - `kicker`   — optional short tag above the title (section or object type).
 * - `title`    — required (`.dx-title`).
 * - `subtitle` — optional (`.dx-sub`); some pages are title-only.
 * - `actions`  — optional, right-aligned via `.dx-head-actions` (filters, primary buttons).
 *
 * Pure presentational (no client hooks), so it composes into both server pages
 * (settings/sources) and `"use client"` components (MonitorsManager).
 */
export function PageHead({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="dx-page-head">
      <div>
        {kicker != null && <span className="dx-kicker">{kicker}</span>}
        <h1 className="dx-title">{title}</h1>
        {subtitle != null && <p className="dx-sub">{subtitle}</p>}
      </div>
      {actions != null && <div className="dx-head-actions">{actions}</div>}
    </div>
  );
}
