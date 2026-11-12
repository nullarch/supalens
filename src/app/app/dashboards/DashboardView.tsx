import Link from "next/link";
import { getTranslations } from "next-intl/server";
import s from "./overview.module.css";
import { DashboardGrid } from "@/components/dashboard/widgets";
import type { GridWidget } from "@/components/dashboard/widgets";
import { getDashboardBySlug } from "@/lib/dashboards/fetch";
import { isCurrentUserAdmin } from "@/lib/auth/is-admin";
import { saveDashboardLayout, removeWidget, updateWidget } from "@/lib/dashboards/actions";
import { SAMPLE_OVERVIEW_WIDGETS } from "@/lib/dashboards/sample";
import { VisualizationSpec } from "@/lib/viz/spec";
import type { ChartSpec } from "@/lib/viz/spec";
import type { DashboardDetail } from "@/lib/dashboards/types";
import { EmptyReport } from "./EmptyReport";

// Demo KPI strip — shown ONLY in unconfigured (local-dev) sample mode. A real board
// renders its own agent-authored KPI widgets, so a fixed fake strip would be a lie.
// Labels come from the `sampleKpiLabels` message array (merged by index).
const KPIS = [
  { value: "₩141.2M", delta: "12.4%", up: true },
  { value: "1,284", delta: "8.1%", up: true },
  { value: "8,420", delta: "2.3%", up: false },
  { value: "3.8%", delta: "0.6%p", up: true },
];

/** A persisted spec may be a full VisualizationSpec envelope; the grid renders a bare ChartSpec + data. */
function chartOf(spec: unknown): ChartSpec {
  const env = VisualizationSpec.safeParse(spec);
  return (env.success ? env.data.chart : spec) as ChartSpec;
}

/**
 * Dashboard view for /app/dashboards/[slug]. When `detail` is passed (real user, verified to
 * exist by the route) it renders that board — real widgets, or a genuine empty state if the
 * board has none (never the fake sample KPIs). With no `detail` (Supabase unconfigured) it
 * shows the demo sample so the shell stays explorable in local dev.
 */
export async function DashboardView({ slug, detail: passed }: { slug: string; detail?: DashboardDetail | null }) {
  const t = await getTranslations("appDashboards");
  const detail = passed !== undefined ? passed : await getDashboardBySlug(slug);
  // Platform-staff flag → unlocks the per-widget SQL debug panel. Returns false when Supabase is
  // unconfigured (demo path) or the user isn't staff; the debug button only shows on real boards
  // (gated on editMeta), so computing it unconditionally is safe.
  const isAdmin = await isCurrentUserAdmin();
  const isReal = !!detail; // a real (possibly empty) dashboard
  const hasWidgets = isReal && detail!.widgets.length > 0;
  const demo = !isReal; // unconfigured / local dev → sample chrome

  const widgets: GridWidget[] = hasWidgets
    ? detail!.widgets.map((wd) => ({
        id: wd.id,
        w: wd.layout.w,
        h: wd.layout.h,
        spec: chartOf(wd.spec),
        data: wd.sample ?? { columns: [], rows: [] },
        error: wd.liveError,
        // monitoring context (fetch.ts) — a widget whose metric is watched says so on the board
        monitor: wd.monitor ?? null,
        definition: wd.definition ?? null,
        // the service each card reads from — a board mixes every source in the workspace
        source: wd.source,
      }))
    : SAMPLE_OVERVIEW_WIDGETS;

  // editable fields per widget (title from the chart spec; SQL only for SQL-backed envelope
  // specs — a Firestore widget's `query.sql` is a display descriptor, not an editable query)
  const editMeta = hasWidgets
    ? Object.fromEntries(
        detail!.widgets.map((wd) => {
          const env = VisualizationSpec.safeParse(wd.spec);
          const editableSql =
            env.success && typeof env.data.query?.sql === "string" && !env.data.query.firestore
              ? env.data.query.sql
              : null;
          return [
            wd.id,
            {
              title: chartOf(wd.spec).title ?? "",
              sql: editableSql,
              refreshInterval: wd.refreshInterval,
            },
          ];
        }),
      )
    : undefined;

  const initialLayout = hasWidgets
    ? {
        order: detail!.widgets.map((wd) => wd.id),
        sizes: Object.fromEntries(detail!.widgets.map((wd) => [wd.id, { w: wd.layout.w, h: wd.layout.h }])),
      }
    : undefined;

  return (
    // A board is a grid, not a reading column: it takes the overview's wide container.
    <div className={s.reportView} data-page-width="wide">
      {demo && <span className={s.sampleBadge}>{t("sampleBadge")}</span>}

      {demo && (
        <div className={s.kpis}>
          {KPIS.map((k, i) => (
            <div key={i} className="dx-kpi">
              <span className="dx-kpi-label">{(t.raw("sampleKpiLabels") as string[])[i]}</span>
              <div className="dx-kpi-value">{k.value}</div>
              <span className={`dx-kpi-delta ${k.up ? "dx-up" : "dx-down"}`}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden>
                  <path
                    d={k.up ? "M8 12.5V3.5M4 7l4-3.5L12 7" : "M8 3.5v9M4 9l4 3.5L12 9"}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {k.delta}
                <span className={s.deltaNote}>{t("kpiVsLastMonth")}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {isReal && !hasWidgets ? (
        <EmptyReport />
      ) : (
        <DashboardGrid
          key={detail?.id ?? slug}
          widgets={widgets}
          storageKey={slug}
          initialLayout={initialLayout}
          onPersist={hasWidgets ? saveDashboardLayout : undefined}
          onRemoveWidget={hasWidgets ? removeWidget : undefined}
          editMeta={editMeta}
          onUpdateWidget={hasWidgets ? updateWidget : undefined}
          isAdmin={isAdmin}
        />
      )}

      {/* The one creative path into a report: build the chart in Ask, then "add widget". */}
      <Link className={s.fab} href="/app/ask" aria-label={t("addWidget")}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className={s.fabLabel}>{t("addWidget")}</span>
      </Link>
    </div>
  );
}
