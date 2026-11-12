"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { WidgetRenderer } from "@/components/dashboard/widgets";
import { PageHead } from "@/components/dashboard/PageHead";
import { Select } from "@/components/ui/Select";
import type { KpiCatalogRow, KpiCategory, KpiExtractionRow } from "@/lib/kpi/types";
import type { DashboardSummary } from "@/lib/dashboards/types";
import { computeDelta, formatValue } from "@/lib/viz/format";
import css from "./kpis.module.css";
import { isConnectionErrorCode } from "@/lib/supabase-oauth/errors";
import { classifyKpiStart } from '../../kpi-start-result';

// Category display order (doc T3): 매출→성장→참여→운영→퍼널→고유. Labels come from the appKpis namespace.
const CATEGORY_ORDER: KpiCategory[] = ["revenue", "growth", "engagement", "ops", "funnel", "custom"];

/** How this KPI will be watched once approved. Honest: no alert config = dashboard only, no monitor. */
type MonitorMode = "anomaly" | "threshold" | "dashboard";
function monitorMode(row: KpiCatalogRow, withAlerts: boolean): MonitorMode {
  if (!withAlerts || !row.alertConfig) return "dashboard";
  return row.alertConfig.type === "anomaly" ? "anomaly" : "threshold";
}

/**
 * Headline value (+ change vs the comparison column) from the PERSISTED sample — zero live queries.
 * Only single-number charts carry one; series charts are shown by the mini preview instead.
 */
function currentFromSample(row: KpiCatalogRow): { value: string; delta: string | null; direction: "up" | "down" | "flat" } | null {
  const chart = row.vizSpec.chart;
  if (chart.type !== "kpi" && chart.type !== "bignumber") return null;
  const first = row.vizSpec.sample?.rows?.[0];
  if (!first) return null;
  const raw = first[chart.value];
  if (raw == null) return null;
  const value = formatValue(raw, chart.format);
  if (chart.type === "kpi" && chart.comparison) {
    const d = computeDelta(raw, first[chart.comparison.value]);
    if (d.deltaPct != null) {
      const pct = `${d.deltaPct > 0 ? "+" : ""}${(d.deltaPct * 100).toFixed(1)}%`;
      return { value, delta: pct, direction: d.direction };
    }
  }
  return { value, delta: null, direction: "flat" };
}

const iconProps = {
  viewBox: "0 0 24 24",
  width: 12,
  height: 12,
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
function BellIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

// Known error codes from the extract route (some responses carry no `message`). Copy lives under
// appKpis.extractError.*; unknown codes use the localized request-failure message.
const KPI_EXTRACT_ERROR_CODES = [
  "trigger_required",
  "trigger_failed",
  "engine_not_supported",
  "demo_not_supported",
  "supabase_not_configured",
] as const;

// The apply route returns this shape (src/lib/kpi/apply.ts ApplyKpisResult). Declared locally so this
// client component never imports the server-only apply module.
interface ApplyItemResult {
  kpiId: string;
  key: string;
  ok: boolean;
  widgetId?: string;
  savedQueryId?: string;
  alertId?: string;
  error?: string;
  errorKind?: "validation" | "cap" | "internal";
}
/** Mirrors ApplyPlan in src/lib/kpi/apply.ts (declared locally — never import the server module). */
type DashboardOnlyReason =
  | "not_time_series"
  | "categorical"
  | "snapshot_only"
  | "low_signal"
  | "alerts_off"
  | "legacy_no_config";
export interface ApplyPlan {
  selected: number;
  monitorsToCreate: number;
  dashboardOnly: Array<{ kpiId: string; key: string; title: string; reason: DashboardOnlyReason }>;
  capBlocked: Array<{ kpiId: string; key: string; title: string; cap: "alerts_per_org" | "widgets_per_dashboard" }>;
  alreadyApplied: number;
  cadenceSeconds: number;
  alertLimit: number | null;
}
export interface ApplyKpisResult {
  ok: boolean;
  dashboardId: string;
  dashboardSlug: string;
  applied: number;
  failed: number;
  items: ApplyItemResult[];
  plan: ApplyPlan;
}

/** The evaluator needs this many trailing points before an anomaly monitor can fire
 *  (MIN_ANOMALY_BASELINE in src/lib/alerts/evaluate.ts). */
const MIN_ANOMALY_BASELINE = 8;

/** Plan cadence as a display string — "5분마다" / "2시간마다", never a promise of 1분. */
function cadenceLabel(seconds: number, t: ReturnType<typeof useTranslations>): string {
  return seconds >= 3600
    ? t("cadence.hours", { n: Math.round(seconds / 3600) })
    : t("cadence.minutes", { n: Math.round(seconds / 60) });
}

type Notice = { kind: "err" | "quota" | "unknown"; text: string };

/** Client adapter for isolated previews. Production keeps the existing API and refresh path. */
export interface KpiReviewActions {
  request: typeof fetch;
  refresh: () => void;
}

/** A KPI is default-checked only if it's a strong, still-open proposal (importance ≥ 4, 'proposed'). */
function defaultSelection(rows: KpiCatalogRow[]): Set<string> {
  return new Set(rows.filter((r) => r.importance >= 4 && r.status === "proposed").map((r) => r.id));
}

/** Strip the chart title/description so the mini-preview collapses its header (the row shows them). */
function toPreviewSpec(row: KpiCatalogRow): unknown {
  return { ...row.vizSpec, chart: { ...row.vizSpec.chart, title: "", description: undefined } };
}

export function KpiReviewClient(props: Parameters<typeof ReviewController>[0]) {
  return <ReviewController key={props.sourceId} {...props} />;
}

function ReviewController({
  sourceId,
  sourceName,
  initialKpis,
  initialExtraction,
  dashboards,
  canManage,
  variant = "page",
  actions,
  onBusyChange,
}: {
  sourceId: string;
  sourceName: string;
  initialKpis: KpiCatalogRow[];
  initialExtraction: KpiExtractionRow | null;
  dashboards: DashboardSummary[];
  canManage: boolean;
  /** 'page' = full route (back link + PageHead); 'modal' = embedded in the sources-page modal
   *  (no back link; the modal's own title supplies the heading, so only a compact header shows). */
  variant?: "page" | "modal";
  actions?: KpiReviewActions;
  onBusyChange?: (busy: boolean) => void;
}) {
  const t = useTranslations("appKpis");
  const ts = useTranslations('appSources');
  const isModal = variant === "modal";
  const router = useRouter();
  const request = actions?.request ?? fetch;
  const refresh = actions?.refresh ?? router.refresh;
  const dashboardGroup = useId();
  const [rows, setRows] = useState<KpiCatalogRow[]>(initialKpis);
  const [extraction, setExtraction] = useState<KpiExtractionRow | null>(initialExtraction);
  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(initialKpis));
  const [dashboardId, setDashboardId] = useState<string>("new");
  const [withAlerts, setWithAlerts] = useState(true);
  const [applying, setApplying] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractUnconfirmed, setExtractUnconfirmed] = useState(false);
  const extractLock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [result, setResult] = useState<ApplyKpisResult | null>(null);
  const [planResponse, setPlanResponse] = useState<{ key: string; status: "loading" | "ready" | "error"; plan?: ApplyPlan } | null>(null);
  const [planRetry, setPlanRetry] = useState(0);
  const [editingProposal, setEditingProposal] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [undo, setUndo] = useState<{ id: string; prev: KpiCatalogRow["status"] } | null>(null);

  const isRunning = extraction?.status === "running";
  const visibleRows = useMemo(() => rows.filter((r) => r.status !== "dismissed"), [rows]);
  const hasRows = visibleRows.length > 0;

  // Selectable = proposed | stale (accepted is already applied, dismissed is hidden).
  const selectableIds = useMemo(
    () => visibleRows.filter((r) => r.status !== "accepted").map((r) => r.id),
    [visibleRows],
  );
  const reviewCount = selectableIds.length;
  const selectedCount = useMemo(
    () => selectableIds.filter((id) => selected.has(id)).length,
    [selectableIds, selected],
  );
  const allSelected = reviewCount > 0 && selectableIds.every((id) => selected.has(id));
  // Honest pre-run split: "N selected" is not "N monitored" — only rows with an alert config get one.
  const monitorCount = useMemo(
    () =>
      selectableIds.filter((id) => {
        if (!selected.has(id)) return false;
        const r = rows.find((x) => x.id === id);
        return !!r && monitorMode(r, withAlerts) !== "dashboard";
      }).length,
    [selectableIds, selected, rows, withAlerts],
  );
  const dashboardOnlyCount = selectedCount - monitorCount;
  const busy = applying || extracting || editingProposal;

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  // Server dry run: the client estimate above answers instantly but knows nothing about plan
  // caps. Debounced so dragging through checkboxes doesn't spam the route; the estimate stays
  // on screen until the server answers. Tag responses so an old plan is never shown for new inputs.
  const selectionKey = useMemo(() => selectableIds.filter(id => selected.has(id)).sort().join(","), [selectableIds, selected]);
  const planKey = JSON.stringify([sourceId, selectionKey, withAlerts, dashboardId]);
  const currentPlanResponse = planResponse?.key === planKey ? planResponse : null;
  const plan = currentPlanResponse?.status === "ready" ? currentPlanResponse.plan ?? null : null;
  const planStatus = !canManage || selectedCount === 0 ? "idle" : currentPlanResponse?.status ?? "loading";
  useEffect(() => {
    const ids = selectionKey ? selectionKey.split(",") : [];
    if (ids.length === 0 || !canManage) {
      setPlanResponse(null);
      return;
    }
    setPlanResponse({ key: planKey, status: "loading" });
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await request(`/api/data-sources/${sourceId}/kpis/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kpiIds: ids,
            dashboardId: dashboardId === "new" ? undefined : dashboardId,
            withAlerts,
            dryRun: true,
          }),
        });
        if (cancelled) return;
        if (!res.ok) throw new Error("Plan preview unavailable");
        const d = (await res.json()) as { plan?: ApplyPlan };
        if (!d.plan) throw new Error("Plan preview missing");
        if (!cancelled) setPlanResponse({ key: planKey, status: "ready", plan: d.plan });
      } catch {
        if (!cancelled) setPlanResponse({ key: planKey, status: "error" });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectionKey, withAlerts, dashboardId, sourceId, canManage, planKey, planRetry, request]);

  // The server number wins once it arrives; the instant estimate covers the gap.
  const shownMonitorCount = plan?.monitorsToCreate ?? monitorCount;
  const shownDashboardOnly = plan ? plan.dashboardOnly.length : dashboardOnlyCount;
  const capBlockedAlerts = plan?.capBlocked.filter((c) => c.cap === "alerts_per_org") ?? [];
  const capBlockedWidgets = plan?.capBlocked.filter((c) => c.cap === "widgets_per_dashboard") ?? [];
  // Group the no-monitor rows by reason so the UI names causes, not just a count.
  const reasonCounts = useMemo(() => {
    const m = new Map<DashboardOnlyReason, number>();
    for (const d of plan?.dashboardOnly ?? []) m.set(d.reason, (m.get(d.reason) ?? 0) + 1);
    return [...m.entries()];
  }, [plan]);

  // Poll while an extraction is running (5s, same cadence as the context chip). On completion, refresh
  // the rows + re-seed the default selection for the freshly-arrived strong proposals.
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await request(`/api/data-sources/${sourceId}/kpis`);
        if (!res.ok || cancelled) return;
        const d = (await res.json()) as { extraction?: KpiExtractionRow | null; kpis?: KpiCatalogRow[] };
        if (cancelled) return;
        const nextRows = d.kpis ?? [];
        const nextExt = d.extraction ?? null;
        setRows(nextRows);
        setExtraction(nextExt);
        if (nextExt?.status !== "running") {
          // Seed the default selection only if the user hasn't picked anything yet (fresh extraction);
          // a re-extraction while the user is mid-review keeps their existing selection intact.
          setSelected((prevSel) => (prevSel.size === 0 ? defaultSelection(nextRows) : prevSel));
          clearInterval(timer);
          refresh();
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isRunning, sourceId, refresh, request]);

  function toggleOne(id: string) {
    if (!canManage || busy) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (!canManage || busy) return;
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  async function refetch() {
    try {
      const res = await request(`/api/data-sources/${sourceId}/kpis`);
      if (!res.ok) return;
      const d = (await res.json()) as { extraction?: KpiExtractionRow | null; kpis?: KpiCatalogRow[] };
      setRows(d.kpis ?? []);
      setExtraction(d.extraction ?? null);
    } catch {
      /* ignore — the current view stays */
    }
  }

  async function dismiss(row: KpiCatalogRow) {
    if (!canManage || busy) return;
    setEditingProposal(true);
    setNotice(null);
    const prev = row.status;
    const wasSelected = selected.has(row.id);
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: "dismissed" } : r)));
    setSelected((s) => {
      const next = new Set(s);
      next.delete(row.id);
      return next;
    });
    setUndo({ id: row.id, prev });
    try {
      const res = await request(`/api/data-sources/${sourceId}/kpis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpiIds: [row.id], status: "dismissed" }),
      });
      if (!res.ok) throw new Error("Proposal update failed");
    } catch {
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, status: prev } : r));
      if (wasSelected) setSelected(ids => new Set([...ids, row.id]));
      setUndo(null);
      setNotice({ kind: "err", text: t("proposalSaveFailed") });
    } finally {
      setEditingProposal(false);
    }
  }
  async function undoDismiss() {
    if (!undo || !canManage || busy) return;
    setEditingProposal(true);
    setNotice(null);
    const u = undo;
    setUndo(null);
    // PATCH only restores to 'proposed' (a formerly-stale row becomes actionable again — fine).
    setRows((rs) => rs.map((r) => (r.id === u.id ? { ...r, status: "proposed" } : r)));
    try {
      const res = await request(`/api/data-sources/${sourceId}/kpis`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpiIds: [u.id], status: "proposed" }),
      });
      if (!res.ok) throw new Error("Proposal update failed");
    } catch {
      setRows(rs => rs.map(r => r.id === u.id ? { ...r, status: "dismissed" } : r));
      setUndo(u);
      setNotice({ kind: "err", text: t("proposalSaveFailed") });
    } finally {
      setEditingProposal(false);
    }
  }

  async function apply() {
    const ids = [...selected].filter((id) => {
      const r = rows.find((x) => x.id === id);
      return r && r.status !== "accepted" && r.status !== "dismissed";
    });
    if (ids.length === 0 || busy || !canManage) return;
    setApplying(true);
    setNotice(null);
    setResult(null);
    try {
      const res = await request(`/api/data-sources/${sourceId}/kpis/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kpiIds: ids,
          dashboardId: dashboardId === "new" ? undefined : dashboardId,
          withAlerts,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as ApplyKpisResult & { error?: string; message?: string };
      if (!res.ok) {
        setNotice({ kind: "err", text: d.message ?? d.error ?? t("applyFailed", { status: res.status }) });
        return;
      }
      setResult(d);
      setSelected(new Set());
      await refetch(); // accepted rows flip to the bottom of their group
      refresh();
    } catch (e) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setApplying(false);
    }
  }

  async function extract() {
    if (extractLock.current || extractUnconfirmed || busy || isRunning || !canManage) return;
    extractLock.current = true;
    setExtracting(true);
    setNotice(null);
    try {
      const res = await request(`/api/data-sources/${sourceId}/kpis/extract`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
        message?: string;
        extractionId?: string;
        tier?: number;
      };
      if (!mounted.current) return;
      const outcome = classifyKpiStart(res.status, d);
      if (outcome.kind === 'unknown') {
        setExtractUnconfirmed(true);
        setNotice({ kind: 'unknown', text: ts('kpi.modal.unconfirmedBody') });
        return;
      }
      if (outcome.kind === 'quota') {
        setNotice({ kind: "quota", text: t("quotaReached") });
        return;
      }
      if (outcome.kind === 'running') {
        setExtraction((prev) => ({
          ...(prev ?? blankExtraction(sourceId)),
          status: "running",
          createdAt: new Date().toISOString(),
        }));
        return;
      }
      if (outcome.kind === 'rejected') {
        const knownCode = (KPI_EXTRACT_ERROR_CODES as readonly string[]).includes(outcome.code ?? "")
          ? t(`extractError.${outcome.code}`)
          : undefined;
        setNotice({
          kind: "err",
          text: knownCode ?? t("extractStartFailed", { status: res.status }),
        });
        return;
      }
      setExtraction({
        ...blankExtraction(sourceId),
        id: d.extractionId ?? "pending",
        status: "running",
        tier: (d.tier as 1 | 2) ?? 1,
      });
    } catch {
      if (!mounted.current) return;
      setExtractUnconfirmed(true);
      setNotice({ kind: 'unknown', text: ts('kpi.modal.unconfirmedBody') });
    } finally {
      extractLock.current = false;
      if (mounted.current) setExtracting(false);
    }
  }

  const failedItems = result?.items.filter((i) => !i.ok) ?? [];
  const noteItems = result?.items.filter((i) => i.ok && i.error) ?? [];
  const createdMonitors = result?.items.filter((i) => i.ok && i.alertId).length ?? 0;
  // An anomaly monitor cannot fire until its series has enough trailing points; say so instead of
  // letting the user think a silent monitor is a broken one.
  const baselinePending = useMemo(() => {
    if (!result) return 0;
    return result.items.filter((i) => {
      if (!i.ok || !i.alertId) return false;
      const row = rows.find((r) => r.id === i.kpiId);
      if (!row || row.alertConfig?.type !== "anomaly") return false;
      return (row.vizSpec.sample?.rows?.length ?? 0) < MIN_ANOMALY_BASELINE;
    }).length;
  }, [result, rows]);

  /* ---- presentation-only derivations ---- */
  const recommendedCount = visibleRows.filter((r) => r.status !== "accepted" && r.importance >= 4).length;
  const outcome = !result ? null
    : result.applied === 0 && result.failed > 0 ? "error"
      : result.failed > 0 || noteItems.length > 0 ? "partial" : "success";
  // Report order: what failed, what landed with a caveat, then what landed cleanly.
  const reportItems = result
    ? [...failedItems, ...noteItems, ...result.items.filter((i) => i.ok && !i.error)]
    : [];
  const titleFor = (kpiId: string, fallback: string) => rows.find((r) => r.id === kpiId)?.title ?? fallback;

  const headerActions = hasRows ? (
    <>
      <button type="button" className="dx-btn-ghost" onClick={toggleAll} disabled={!canManage || busy || reviewCount === 0}>
        {allSelected ? t("deselectAll") : t("selectAll")}
      </button>
      {canManage && (
        <button type="button" className="dx-btn-ghost" onClick={extract} disabled={busy || isRunning || extractUnconfirmed}>
          {isRunning ? t("extractingShort") : t("reExtract")}
        </button>
      )}
    </>
  ) : null;

  return (
    <div className={css.review} data-variant={variant}>
      {isModal ? (
        <div className={css.modalHead}>
          <p className={css.modalSub}>{hasRows ? t("sub.withRows", { count: reviewCount }) : t("sub.empty")}</p>
          {headerActions && <div className={css.modalActions}>{headerActions}</div>}
        </div>
      ) : (
        <>
          <Link href="/app/sources" className={css.back}>
            {t("back")}
          </Link>
          <PageHead
            title={t("title")}
            subtitle={
              <>
                <span className={css.sourceName}>{sourceName}</span>
                <span className={css.ledeSep} aria-hidden>·</span>
                {hasRows ? t("sub.withRows", { count: reviewCount }) : t("sub.empty")}
              </>
            }
            actions={headerActions}
          />
        </>
      )}

      {notice && <NoticeBanner notice={notice} />}

      {/* running banner (a re-extraction while rows already exist) */}
      {hasRows && isRunning && (
        <div className={css.strip}>
          <span className="dx-dot dx-dot-sync" aria-hidden />
          <span>{t("runningBanner")}</span>
        </div>
      )}

      {undo && (
        <div className={css.strip}>
          <span role="status">{editingProposal ? t("proposalSaving") : t("dismissedNote")}</span>
          <button type="button" className={`dx-btn-ghost dx-btn-sm ${css.stripAction}`} onClick={undoDismiss} disabled={busy}>
            {t("undo")}
          </button>
        </div>
      )}

      {result && (
        <section className={css.result} data-outcome={outcome} aria-label={t("result.title")}>
          <div className={css.resultHead}>
            <div className={css.resultLead}>
              <span className={css.resultLabel}>
                <span
                  className={`dx-dot ${outcome === "error" ? "dx-dot-attention" : outcome === "partial" ? "dx-dot-warning" : "dx-dot-ok"}`}
                  aria-hidden
                />
                {t("result.title")}
              </span>
              <p role="status" className={css.resultSummary}>
                {t("result.summary", {
                  widgets: result.items.filter((i) => i.ok && i.widgetId).length,
                  monitors: result.items.filter((i) => i.ok && i.alertId).length,
                })}
                {result.failed > 0 ? t("result.failedSuffix", { count: result.failed }) : ""}
              </p>
            </div>
            {result.applied > 0 && (
              <div className={css.resultCtas}>
                {/* Monitoring is only useful once it can reach someone — Slack is the next step,
                    the dashboard is the sideshow. */}
                <Link href="/app/setup" className="dx-btn">
                  {t("result.nextSlack")}
                </Link>
                <Link href={`/app/dashboards/${result.dashboardSlug}`} className="dx-btn-ghost">
                  {t("result.viewDashboardSecondary")}
                </Link>
              </div>
            )}
          </div>
          {createdMonitors > 0 && (
            <p className={css.resultMeta}>
              <span>{t("result.cadence", { cadence: cadenceLabel(result.plan.cadenceSeconds, t) })}</span>
              <span>{t("result.scheduleNote")}</span>
              {baselinePending > 0 && (
                <span>{t("result.baseline", { count: baselinePending, need: MIN_ANOMALY_BASELINE })}</span>
              )}
            </p>
          )}
          {reportItems.length > 0 && (
            <ul className={css.report}>
              {reportItems.map((it) => {
                const state = !it.ok ? "failed" : it.error ? "note" : "ok";
                return (
                  <li key={it.kpiId} className={css.reportRow} data-state={state}>
                    <span
                      className={`dx-dot ${state === "failed" ? "dx-dot-attention" : state === "note" ? "dx-dot-warning" : "dx-dot-ok"}`}
                      aria-hidden
                    />
                    <span className={css.reportName}>
                      <span className={css.reportTitle}>{titleFor(it.kpiId, it.key || it.kpiId)}</span>
                      <code className={css.reportKey}>{it.key || it.kpiId}</code>
                    </span>
                    <span className={css.reportOutcome}>
                      {state === "ok" ? (it.alertId ? t("result.item.monitor") : t("result.item.widget")) : it.error}
                      {it.errorKind === "cap" && (
                        <Link href="/app/settings/billing" className={css.inlineLink}>
                          {t("upgradePlan")}
                        </Link>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {hasRows ? (
        <>
          {/* approve summary: the figures, the honest monitor split, the master alert toggle and
              the dashboard target under Advanced. The CTA lives in the sticky bar below the list. */}
          <section className={css.approval} aria-label={t("preview.title")} aria-busy={applying}>
            <dl className={css.figures}>
              <div className={css.figure}>
                <dt>{t("figures.proposed")}</dt>
                <dd>{reviewCount}</dd>
              </div>
              <div className={css.figure}>
                <dt>{t("figures.recommended")}</dt>
                <dd>{recommendedCount}</dd>
              </div>
              <div className={css.figure} data-accent>
                <dt>{t("figures.selected")}</dt>
                <dd>{selectedCount}</dd>
              </div>
            </dl>

            <div className={css.plan}>
              <div className={css.planHead} data-state={planStatus}>
                <h2 className={css.planTitle}>{t("preview.title")}</h2>
                {canManage && selectedCount > 0 && <p role="status" className={css.planStatus}>{t(`preview.${planStatus}`)}</p>}
                {planStatus === "error" && (
                  <button type="button" className="dx-btn-ghost dx-btn-sm" disabled={busy} onClick={() => setPlanRetry((n) => n + 1)}>
                    {t("preview.retry")}
                  </button>
                )}
              </div>

              <div className={css.split} aria-live="polite">
                <span className={css.splitItem} data-tone={shownMonitorCount > 0 ? "on" : undefined}>
                  {t("summary.monitors", { count: shownMonitorCount })}
                </span>
                <span className={css.splitItem} data-tone="muted">
                  {t("summary.dashboardOnly", { count: shownDashboardOnly })}
                </span>
                {plan && plan.alreadyApplied > 0 && (
                  <span className={css.splitItem} data-tone="muted">{t("plan.alreadyApplied", { count: plan.alreadyApplied })}</span>
                )}
              </div>

              {/* WHY those KPIs get no monitor — a count alone reads like a bug. */}
              {reasonCounts.length > 0 && (
                <div className={css.reasons}>
                  <span className={css.reasonsLabel}>{t("plan.why", { count: shownDashboardOnly, selected: selectedCount })}</span>
                  <span className={css.reasonList}>
                    {reasonCounts.map(([reason, count]) => (
                      <span key={reason} className={css.reasonChip}>
                        {t(`noMonitor.${reason}`)}
                        <span className={css.reasonCount}>{count}</span>
                      </span>
                    ))}
                  </span>
                </div>
              )}

              {/* Plan caps announced BEFORE the run, naming the KPIs that will be skipped. */}
              {(capBlockedAlerts.length > 0 || capBlockedWidgets.length > 0) && (
                <div className={css.capWarn} role="status">
                  {capBlockedAlerts.length > 0 && (
                    <p className={css.capLine}>
                      {t("plan.capWarning", { count: capBlockedAlerts.length, limit: plan?.alertLimit ?? 0 })}
                      <span className={css.capKeys}>{capBlockedAlerts.map((c) => c.title).join(", ")}</span>
                    </p>
                  )}
                  {capBlockedWidgets.length > 0 && (
                    <p className={css.capLine}>
                      {t("plan.capWidgets", { count: capBlockedWidgets.length })}
                      <span className={css.capKeys}>{capBlockedWidgets.map((c) => c.title).join(", ")}</span>
                    </p>
                  )}
                  <Link href="/app/settings/billing" className={css.inlineLink}>
                    {t("upgradePlan")}
                  </Link>
                </div>
              )}

              <div className={css.planFoot}>
                <label className={css.alertToggle}>
                  <button
                    type="button"
                    className="dx-toggle"
                    data-on={withAlerts}
                    aria-pressed={withAlerts}
                    aria-label={withAlerts ? t("alertsAriaOff") : t("alertsAriaOn")}
                    onClick={() => setWithAlerts((v) => !v)}
                    disabled={!canManage || busy}
                  />
                  <span className={css.alertText}>
                    {t("includeAlerts")} <span className={css.alertHint}>{t("includeAlertsHint")}</span>
                  </span>
                </label>
                {/* Cadence comes from the org's plan (2h/10m/5m), never a promise of 1분. */}
                <p className={css.cadence}>
                  {plan ? t("cadenceNote", { cadence: cadenceLabel(plan.cadenceSeconds, t) }) : t("preview.cadenceUnknown")}
                </p>
              </div>

              <details className={css.advanced}>
                <summary>{t("advanced")}</summary>
                <div className={css.picker} role="group" aria-label={t("picker.label")}>
                  <span className={css.pickerLabel}>{t("picker.label")}</span>
                  <label className={css.pickerOpt}>
                    <input type="radio" name={dashboardGroup} checked={dashboardId === "new"} disabled={!canManage || busy} onChange={() => setDashboardId("new")} />
                    {t("picker.new")}
                  </label>
                  <label className={css.pickerOpt} data-disabled={dashboards.length === 0 || undefined}>
                    <input
                      type="radio"
                      name={dashboardGroup}
                      checked={dashboardId !== "new"}
                      disabled={!canManage || busy || dashboards.length === 0}
                      onChange={() => setDashboardId(dashboards[0]?.id ?? "new")}
                    />
                    {t("picker.existing")}
                  </label>
                  {dashboardId !== "new" && dashboards.length > 0 && (
                    <Select
                      size="sm"
                      rootClassName={css.pickerSelect}
                      value={dashboardId}
                      onValueChange={setDashboardId}
                      disabled={!canManage || busy}
                      ariaLabel={t("picker.existing")}
                      options={dashboards.map((d) => ({ value: d.id, label: d.name }))}
                    />
                  )}
                </div>
              </details>
            </div>
          </section>

          <div className={css.groups}>
            {CATEGORY_ORDER.map((cat) => {
              const catRows = visibleRows
                .filter((r) => r.category === cat)
                .sort((a, b) => {
                  const aAccepted = a.status === "accepted" ? 1 : 0;
                  const bAccepted = b.status === "accepted" ? 1 : 0;
                  if (aAccepted !== bAccepted) return aAccepted - bAccepted;
                  return b.importance - a.importance;
                });
              if (catRows.length === 0) return null;
              return (
                <section key={cat} className={css.group}>
                  <div className={css.groupHead}>
                    <h2 className={css.groupTitle}>{t(`category.${cat}`)}</h2>
                    <span className={css.groupCount}>{catRows.length}</span>
                  </div>
                  <div className={css.board}>
                    {catRows.map((r) => (
                      <KpiRow
                        key={r.id}
                        row={r}
                        checked={selected.has(r.id)}
                        withAlerts={withAlerts}
                        canManage={canManage}
                        busy={busy}
                        onToggle={() => toggleOne(r.id)}
                        onDismiss={() => dismiss(r)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {/* The decision stays in reach while the proposals scroll past. */}
          <div className={css.actionBar}>
            {canManage ? (
              <p className={css.actionCount}>
                <span className={css.actionNum}>{t("summary.selected", { count: selectedCount })}</span>
                <span className={css.actionSub}>
                  {t("summary.monitors", { count: shownMonitorCount })} · {t("summary.dashboardOnly", { count: shownDashboardOnly })}
                </span>
              </p>
            ) : (
              <p className={css.actionCount}>
                <span className={css.actionSub}>{t("viewOnly")}</span>
              </p>
            )}
            <button type="button" className={`dx-btn ${css.applyBtn}`} onClick={apply} disabled={!canManage || busy || selectedCount === 0}>
              {applying
                ? t("applying")
                : shownMonitorCount > 0
                  ? t("approveCta", { count: shownMonitorCount })
                  : t("approveCtaDashboardOnly", { count: selectedCount })}
            </button>
          </div>
        </>
      ) : isRunning ? (
        <section className={css.emptyPanel} data-kind="running">
          <h2 className={css.emptyTitle}>
            <span className={`dx-dot dx-dot-sync ${css.emptyDot}`} aria-hidden />
            {t("runningTitle")}
          </h2>
          <p className={css.emptyDesc}>{t("runningDesc")}</p>
        </section>
      ) : (
        <section className={css.emptyPanel}>
          <h2 className={css.emptyTitle}>{t("emptyTitle")}</h2>
          <p className={css.emptyDesc}>{t("emptyDesc")}</p>
          {extraction?.status === "failed" && extraction.error && (
            <p className={css.emptyError}>
              <span className="dx-dot dx-dot-attention" aria-hidden />
              <span>{isConnectionErrorCode(extraction.error) ? t("lastFailedReconnect") : t("lastFailed", { error: extraction.error })}</span>
            </p>
          )}
          {canManage ? (
            <button type="button" className="dx-btn" onClick={extract} disabled={busy || extractUnconfirmed}>
              {extracting ? t("starting") : t("startExtract")}
            </button>
          ) : (
            <p className={css.emptyNote}>{t("extractMemberOnly")}</p>
          )}
        </section>
      )}
    </div>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  const t = useTranslations("appKpis");
  const ts = useTranslations('appSources');
  return (
    <div role="alert" className={css.notice} data-kind={notice.kind}>
      <span className={css.noticeText}>{notice.text}</span>
      {notice.kind === "quota" && <Link href="/app/settings/billing" className="dx-btn">{t("upgradePlan")}</Link>}
      {/* Native GET re-reads the source after an uncertain extraction request. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      {notice.kind === 'unknown' && <a href="/app/sources" className="dx-btn">{ts('kpi.modal.reload')}</a>}
    </div>
  );
}

function KpiRow({
  row,
  checked,
  withAlerts,
  canManage,
  busy,
  onToggle,
  onDismiss,
}: {
  row: KpiCatalogRow;
  checked: boolean;
  withAlerts: boolean;
  canManage: boolean;
  busy: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("appKpis");
  const isAccepted = row.status === "accepted";
  const isStale = row.status === "stale";
  const recommended = row.importance >= 4;
  const mode = monitorMode(row, withAlerts);
  const current = currentFromSample(row);
  return (
    <article className={css.card} data-status={row.status} data-checked={checked && !isAccepted}>
      <label className={css.checkHit}>
        <input
          type="checkbox"
          className={css.check}
          checked={checked}
          disabled={isAccepted || !canManage || busy}
          onChange={onToggle}
          aria-label={t("selectAria", { title: row.title })}
        />
      </label>

      <div className={css.cardBody}>
        <div className={css.titleLine}>
          <h3 className={css.cardTitle}>{row.title}</h3>
          {recommended && <span className="dx-badge dx-badge-clay">{t("badge.recommended")}</span>}
          {isStale && <span className="dx-badge dx-badge-warning">{t("badge.stale")}</span>}
          {isAccepted && <span className="dx-badge dx-badge-success">{t("badge.accepted")}</span>}
        </div>
        <div className={css.metaLine}>
          <span className={css.importance}>
            <span className={css.pips} aria-hidden>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} data-on={n <= row.importance || undefined} />
              ))}
            </span>
            {t("importance", { value: row.importance })}
          </span>
          <code className={css.key}>{row.key}</code>
        </div>
        {row.description && <p className={css.desc}>{row.description}</p>}
        {current && (
          <p className={css.current}>
            <span className={css.currentLabel}>{t("current.label")}</span>
            <span className={css.currentValue}>{current.value}</span>
            {current.delta && <span className={css.currentDelta}>{current.delta}</span>}
          </p>
        )}
        {row.evidence.length > 0 && (
          <ul className={css.evidence}>
            {row.evidence.map((e, i) => (
              <li key={`${e.kind}-${i}`} className={css.evChip} data-kind={e.kind} title={e.note ?? e.ref}>
                <span className={css.evKind}>{t(`evidence.${e.kind}`)}</span>
                <span className={css.evRef}>{e.ref}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={css.cardSide}>
        <div className={css.previewFrame}>
          <div className={css.preview}>
            <WidgetRenderer spec={toPreviewSpec(row)} menu={null} fill />
          </div>
          {mode === "dashboard" ? (
            <p
              className={css.mode}
              data-mode="dashboard"
              /* The reason is what turns "no monitor" from a defect into a decision. */
              title={row.noMonitor?.note ?? (row.noMonitor ? t(`noMonitor.${row.noMonitor.reason}`) : undefined)}
            >
              <span className={css.modeName}>{t("tag.dashboardOnly")}</span>
              {row.noMonitor && <span className={css.modeReason}>{t(`noMonitor.${row.noMonitor.reason}`)}</span>}
            </p>
          ) : (
            <p className={css.mode} data-mode={mode}>
              <BellIcon />
              <span className={css.modeName}>{mode === "anomaly" ? t("tag.anomaly") : t("tag.threshold")}</span>
            </p>
          )}
        </div>
      </div>

      {canManage && !isAccepted && (
        <button type="button" className={css.dismiss} onClick={onDismiss} disabled={busy} aria-label={t("excludeAria", { title: row.title })} title={t("excludeTitle")}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </article>
  );
}

/** A placeholder extraction row used to flip the UI into the 'running' state on a fresh trigger. */
function blankExtraction(dataSourceId: string): KpiExtractionRow {
  return {
    id: "pending",
    orgId: "",
    dataSourceId,
    status: "running",
    tier: 1,
    proposedCount: null,
    error: null,
    triggerRunId: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}
