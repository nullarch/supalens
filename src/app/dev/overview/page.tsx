import { notFound } from "next/navigation";

import "@/app/app/dashboard.css"; // .dx-* classes the overview renders with
import DashboardShell from "@/components/dashboard/DashboardShell";
import { computeActivation, type ActivationInputs } from "@/lib/activation/logic";
import { serviceStage, type ScanPhase } from "@/lib/activation/overview-stage";
import type { Incident } from "@/lib/alerts/incidents";
import { buildReports, type ReportContext, type ReportExtraction } from "@/lib/reports/build";
import { byKey } from "@/components/dashboard/widgets/__fixtures__/samples";
import { OverviewView, type OverviewViewProps, type ProposalPreview } from "@/app/app/overview/OverviewView";
import { ReportsView, type ReportsViewProps } from "@/app/app/reports/ReportsView";
import type { OverviewMonitor, OverviewService } from "@/app/app/reports/workspace";
import {
  SetupClient,
  type SetupClientProps,
} from "@/app/app/setup/SetupClient";
import type { AppChrome, DashboardDetail, DashboardSummary, DashboardWidgetRecord } from "@/lib/dashboards/types";
import type { WidgetSource } from "@/lib/dashboards/widget-source";
import type { HomeReason } from "@/lib/dashboards/home-pick";
import type { SupabaseProjectChoice } from "@/lib/data-sources/supabase-projects";

// Dev-only visual preview of the /app/overview report inbox — NO auth, NO DB. Mounts the REAL
// OverviewView in the real shell with reports built by the real builder (lib/reports/build) from
// fixture incidents, extractions and context documents — one case per source stage, plus the
// multi-source `all` view and one source of many:
//   npm run dev → http://localhost:3000/dev/overview?mode=<case>   (default: every case, stacked)
//   cases: see OVERVIEW_MODES below
//   ?view=setup-flow | setup-done | setup-picker | setup-slack   — the /app/setup Golden Path shell
// Each service derives stage/board/recovery from the same pure function the page uses
// (serviceStage), so a fixture can't show a combination the page would never render.
// notFound() in production, same as the other /dev galleries.

export const metadata = { robots: { index: false } };

const MOCK_CHROME: AppChrome = {
  dashboards: [
    { id: "d1", slug: "core-kpi", name: "핵심 KPI", pinned: true, position: 0 },
  ],
  user: {
    name: "김하나",
    email: "admin@example.com",
    initials: "박주",
    isAdmin: false,
  },
  org: { id: "o1", name: "Acme", initials: "AC" },
  orgs: [
    {
      id: "o1",
      name: "Acme",
      slug: "acme",
      initials: "AC",
      role: "owner",
    },
  ],
  billing: {
    plan: "free",
    queriesUsed: 3,
    queriesLimit: 15,
    monitorsUsed: 3,
    monitorsLimit: 3,
  },
  monitors: { enabled: 3 },
};

const FRESH: ActivationInputs = {
  realActiveSources: 1,
  reposAttached: 0,
  contextsGenerated: 0,
  kpisProposed: 0,
  kpisAccepted: 0,
  monitorsEnabled: 0,
  slackConnected: false,
  alertChannelConfigured: false,
};
const ACTIVATED: ActivationInputs = {
  realActiveSources: 1,
  reposAttached: 1,
  contextsGenerated: 1,
  kpisProposed: 7,
  kpisAccepted: 5,
  monitorsEnabled: 3,
  slackConnected: true,
  alertChannelConfigured: true,
};

const TZ = "Asia/Seoul";
/** Fixtures are relative to the render clock, so "today" and "yesterday" always read true. */
const NOW = Date.now();
const MIN = 60_000;
const ago = (minutes: number) => new Date(NOW - minutes * MIN).toISOString();

const MONITORS: OverviewMonitor[] = [
  { id: "a1", name: "일 매출", health: "incident", value: "3,120,000", expected: "≥ 4,000,000", agoMin: 3 },
  { id: "a4", name: "환불률", health: "error", value: null, expected: "≤ 5.00", agoMin: 8 },
  { id: "a2", name: "결제 전환율", health: "healthy", value: "3.80", expected: "≥ 3.00", agoMin: 3 },
  { id: "a3", name: "재구독률 · 30일", health: "healthy", value: "27.50", expected: null, agoMin: 3 },
  { id: "a5", name: "신규 가입", health: "paused", value: "214", expected: null, agoMin: 2880 },
];
const HEALTHY = MONITORS.filter((m) => m.health === "healthy").concat([
  { id: "a6", name: "활성 구독 수", health: "healthy", value: "1,284", expected: "≥ 1,000", agoMin: 4 },
]);

const EXPLANATION = [
  "데이터에서 확인됨:",
  "갱신 매출 −31%(₩2.9M → ₩2.0M), 신규 구독 −4%로 평소 범위. 일본 −52%, 미국 정상.",
  "가능성 높은 원인:",
  "결제 웹훅 실패율이 0.3%에서 7.8%로 오른 구간과 매출 하락 구간이 겹칩니다.",
].join("\n");

type FixtureIncident = Incident & { dataSourceId: string | null };

const incident = (over: Partial<FixtureIncident> = {}): FixtureIncident => ({
  id: "e1", alertId: "a1", alertName: "일 매출", alertType: "threshold", dataSourceName: "my-prod", dataSourceId: "s1",
  status: "open", severity: "high", value: 3_120_000, threshold: 4_000_000, operator: "lt", changePct: -22, zScore: null,
  fireThreshold: 1, firedAt: ago(74), resolvedAt: null, resolvedValue: null, durationMs: 74 * MIN, message: null,
  explanation: EXPLANATION, explained: true, notified: true, ack: null, feedback: null, ...over,
});

/** A resolved incident that fired `daysAgo` days ago and lasted `minutes`. */
const resolved = (id: string, daysAgo: number, minutes: number, over: Partial<FixtureIncident> = {}): FixtureIncident =>
  incident({
    id, status: "resolved", severity: "low", firedAt: ago(daysAgo * 1440 + minutes), resolvedAt: ago(daysAgo * 1440),
    resolvedValue: 4_210_000, durationMs: minutes * MIN, explanation: null, explained: false, ...over,
  });

/** A month of history for an operating service: recoveries on a few days, quiet days between. */
const HISTORY = (sourceId = "s1", sourceName = "my-prod"): FixtureIncident[] => [
  resolved(`${sourceId}-r1`, 1, 95, { dataSourceId: sourceId, dataSourceName: sourceName }),
  resolved(`${sourceId}-r2`, 3, 40, { dataSourceId: sourceId, dataSourceName: sourceName, alertId: "a4", alertName: "환불률", value: 6.2, threshold: 5, operator: "gt", changePct: 24, resolvedValue: 4.1 }),
  resolved(`${sourceId}-r3`, 8, 180, { dataSourceId: sourceId, dataSourceName: sourceName, alertId: "a2", alertName: "결제 전환율", value: 2.4, threshold: 3, operator: "lt", changePct: -20, resolvedValue: 3.3 }),
  resolved(`${sourceId}-r4`, 10, 30, { dataSourceId: sourceId, dataSourceName: sourceName }),
];

type ServiceFields = Omit<OverviewService, "stage" | "board" | "recovery">;

const SERVICE_BASE: ServiceFields = {
  id: "s1",
  name: "my-prod",
  engine: "supabase",
  repoAttached: false,
  reconnectHref: "/api/connect-supabase/authorize?returnTo=%2Fapp%2Foverview%3Fsource%3Ds1",
  monitorCount: 0,
  monitorTotal: 0,
  firingCount: 0,
  erroredCount: 0,
  pendingCheckCount: 0,
  brokenCount: 0,
  checkedAgo: null,
  nextMin: 5,
  kpiHref: "/app/sources/s1/kpis",
  monitors: [],
  pendingCount: 0,
};

/**
 * One service. Its stage comes from the same pure function the page uses, fed from the view
 * counts, so a fixture can't show a combination the page would never render. `checked` is the
 * number of evaluated enabled monitors (defaults to all enabled when any was checked); `scan`
 * is the analysis progress.
 */
function service(
  over: Partial<ServiceFields>,
  opts: { checked?: number; scan?: { context: ScanPhase; kpi: ScanPhase } } = {},
): OverviewService {
  const v = { ...SERVICE_BASE, ...over, kpiHref: `/app/sources/${over.id ?? SERVICE_BASE.id}/kpis` };
  return {
    ...v,
    ...serviceStage({
      scan: opts.scan ?? { context: "done", kpi: "done" },
      pendingProposals: v.pendingCount,
      monitorsTotal: v.monitorTotal,
      monitorsEnabled: v.monitorCount,
      monitorsChecked: opts.checked ?? (v.checkedAgo != null ? v.monitorCount : 0),
      firing: v.firingCount,
      errored: v.erroredCount,
      connectionErrors: v.brokenCount,
    }),
  };
}

const operating: Partial<ServiceFields> = {
  repoAttached: true,
  monitorCount: 4,
  monitorTotal: 5,
  checkedAgo: 3,
  monitors: MONITORS.slice(2, 5),
};

type Case = {
  services: OverviewService[];
  view?: "all" | "single";
  focusId?: string;
  incidents?: FixtureIncident[];
  extractions?: ReportExtraction[];
  contexts?: ReportContext[];
  monitoringSince?: string | null;
  canManage?: boolean;
  connectionPending?: boolean;
  ackReady?: boolean;
  intervalMin?: number;
};

/** A one-source org: always the single view. */
const one = (svc: OverviewService, extra: Partial<Case> = {}): Case => ({ services: [svc], ...extra });

const SVC = {
  healthy: service({ ...operating, monitorCount: 4, monitorTotal: 4, monitors: HEALTHY.slice(0, 3) }),
  incident: service({ ...operating, firingCount: 1, erroredCount: 1, monitors: MONITORS.slice(0, 3) }),
  proposals: service({ pendingCount: 21 }),
};
const SINCE = ago(12 * 1440);
const KPI_DONE = (id: string): ReportExtraction => ({ dataSourceId: id, status: "completed", createdAt: ago(45), completedAt: ago(32), proposedCount: 21 });
const CONTEXT = (id: string): ReportContext => ({ dataSourceId: id, status: "fresh", generatedAt: ago(52), fromRepo: true });

const CASES: Record<string, Case> = {
  /* ---- one source (or none): the single view ---- */
  empty: { services: [] },
  analyzing: one(service({}, { scan: { context: "done", kpi: "running" } })),
  proposals: one(SVC.proposals, { extractions: [KPI_DONE("s1")], contexts: [CONTEXT("s1")] }),
  extract: one(service({ repoAttached: true }), { contexts: [CONTEXT("s1")] }),
  "scan-failed": one(service({}, { scan: { context: "failed", kpi: "pending" } }), {
    extractions: [{ dataSourceId: "s1", status: "failed", createdAt: ago(20), completedAt: null, proposedCount: null }],
  }),
  "first-check": one(
    service({ monitorCount: 3, monitorTotal: 3, pendingCheckCount: 3, nextMin: 42, monitors: HEALTHY.slice(0, 3).map((m) => ({ ...m, health: "pending", value: null, agoMin: null })) }, { checked: 0 }),
    { monitoringSince: ago(20), intervalMin: 120 },
  ),
  healthy: one(SVC.healthy, { monitoringSince: SINCE, incidents: HISTORY() }),
  incident: one(SVC.incident, { monitoringSince: SINCE, incidents: [incident(), ...HISTORY()], extractions: [KPI_DONE("s1")] }),
  "incident-acked": one(SVC.incident, {
    monitoringSince: SINCE,
    incidents: [incident({ ack: { at: ago(12), by: "u1", kind: "ack" } }), ...HISTORY()],
  }),
  investigating: one(SVC.incident, {
    monitoringSince: SINCE,
    incidents: [incident({ status: "investigating", firedAt: ago(4), durationMs: 4 * MIN, explanation: null, explained: false, severity: "medium" })],
  }),
  degraded: one(service({ ...operating, erroredCount: 4, monitorTotal: 4, monitors: HEALTHY.slice(0, 3).map((m) => ({ ...m, health: "error", value: null })) }), {
    monitoringSince: SINCE, incidents: HISTORY(),
  }),
  reconnect: one(service({ ...operating, erroredCount: 2, brokenCount: 2, monitorTotal: 4, monitors: MONITORS.slice(1, 4) }), {
    monitoringSince: SINCE, incidents: HISTORY(),
  }),
  paused: one(service({ ...operating, monitorCount: 0, monitorTotal: 3, checkedAgo: null, monitors: HEALTHY.slice(0, 3).map((m) => ({ ...m, health: "paused" })) }), {
    monitoringSince: SINCE, incidents: HISTORY(),
  }),
  "no-ack": one(SVC.incident, { monitoringSince: SINCE, incidents: [incident()], ackReady: false }),
  long: one(
    service({ ...operating, monitorCount: 3, monitorTotal: 3, name: "international-subscription-production-cluster", monitors: HEALTHY.slice(0, 3).map((m) => ({ ...m, name: `${m.name} · International_subscription_entitlement_consistency_check_2026`, value: "12,345,678,901,234.56" })) }),
    {
      monitoringSince: SINCE,
      incidents: [incident({ dataSourceName: "international-subscription-production-cluster", alertName: "International_subscription_entitlement_consistency_check_2026", value: 12_345_678_901_234.56, threshold: 12_345_678_901_234 })],
    },
  ),

  /* ---- several sources: the all view, and one of them in full ---- */
  "all-mixed": {
    view: "all",
    monitoringSince: SINCE,
    services: [
      { ...SVC.incident, id: "m1", name: "acme-prod" },
      { ...SVC.proposals, id: "m2", name: "acme-analytics", kpiHref: "/app/sources/m2/kpis" },
      service({ id: "m3", name: "mobile-events", engine: "firestore" }, { scan: { context: "running", kpi: "pending" } }),
      { ...SVC.healthy, id: "m4", name: "billing", engine: "mysql" },
    ],
    incidents: [
      incident({ dataSourceId: "m1", dataSourceName: "acme-prod" }),
      ...HISTORY("m1", "acme-prod").slice(0, 2),
      ...HISTORY("m4", "billing").slice(1, 3),
    ],
    extractions: [KPI_DONE("m2")],
    contexts: [CONTEXT("m2")],
  },
  "all-quiet": {
    view: "all",
    monitoringSince: SINCE,
    services: [
      { ...SVC.healthy, id: "n1", name: "acme-prod" },
      service({ ...operating, id: "n2", name: "acme-analytics", engine: "postgresql", monitorCount: 2, monitorTotal: 2, monitors: HEALTHY.slice(0, 2) }),
    ],
    incidents: HISTORY("n1", "acme-prod").slice(2),
  },
  "all-many": {
    view: "all",
    monitoringSince: SINCE,
    services: [
      service({ ...operating, id: "x1", name: "acme-prod", erroredCount: 2, brokenCount: 2, monitors: MONITORS.slice(1, 4), monitorTotal: 4 }),
      service({ ...operating, id: "x2", name: "billing-mysql", engine: "mysql", erroredCount: 1, monitorCount: 3, monitorTotal: 3, monitors: [{ ...HEALTHY[0], health: "error", value: null }, ...HEALTHY.slice(1, 3)] }),
      service({ ...operating, id: "x3", name: "international-subscription-production-cluster", monitorCount: 0, monitorTotal: 2, checkedAgo: null, monitors: HEALTHY.slice(0, 2).map((m) => ({ ...m, health: "paused" })) }),
      service({ id: "x4", name: "growth-warehouse", engine: "postgresql", monitorCount: 2, monitorTotal: 2, pendingCheckCount: 2, nextMin: 3, monitors: HEALTHY.slice(0, 2).map((m) => ({ ...m, health: "pending", value: null, agoMin: null })) }, { checked: 0 }),
      service({ id: "x5", name: "mobile-events", engine: "firestore", repoAttached: true }),
      service({ ...operating, id: "x6", name: "support-desk", monitorCount: 6, monitorTotal: 6, monitors: HEALTHY.slice(0, 3) }),
    ],
    incidents: [...HISTORY("x6", "support-desk"), ...HISTORY("x1", "acme-prod").slice(0, 1)],
  },
  "all-viewer": {
    view: "all",
    canManage: false,
    monitoringSince: SINCE,
    services: [
      service({ ...operating, id: "v1", name: "acme-prod", firingCount: 1, monitors: MONITORS.slice(0, 3) }),
      service({ id: "v2", name: "acme-staging", pendingCount: 8 }),
    ],
    incidents: [incident({ dataSourceId: "v1", dataSourceName: "acme-prod" })],
  },
  "single-of-many": {
    view: "single",
    focusId: "m1",
    monitoringSince: SINCE,
    services: [
      { ...SVC.incident, id: "m1", name: "acme-prod" },
      { ...SVC.proposals, id: "m2", name: "acme-analytics", kpiHref: "/app/sources/m2/kpis" },
      { ...SVC.healthy, id: "m4", name: "billing", engine: "mysql" },
    ],
    incidents: [incident({ dataSourceId: "m1", dataSourceName: "acme-prod" }), ...HISTORY("m1", "acme-prod"), ...HISTORY("m4", "billing")],
    extractions: [KPI_DONE("m2")],
  },
};

const REPORT_MODES = [
  "empty", "analyzing", "proposals", "extract", "scan-failed", "first-check",
  "healthy", "incident", "incident-acked", "investigating", "degraded", "reconnect", "paused", "no-ack", "long",
  "all-mixed", "all-quiet", "all-many", "all-viewer", "single-of-many",
] as const;

function reportsProps(c: Case): ReportsViewProps {
  const view = c.view ?? (c.services.length <= 1 ? "single" : "all");
  const focusId = view === "single" ? c.focusId ?? c.services[0]?.id ?? null : null;
  const focus = view === "single" && c.services.length > 1 ? c.services.find((svc) => svc.id === focusId) ?? null : null;
  const reports = buildReports(
    {
      now: NOW,
      timeZone: TZ,
      services: c.services,
      incidents: c.incidents ?? [],
      extractions: c.extractions ?? [],
      contexts: c.contexts ?? [],
      monitoringSince: c.monitoringSince ?? null,
    },
    focus ? { id: focus.id, name: focus.name } : null,
  );
  return {
    view,
    focusId,
    services: c.services,
    canManage: c.canManage ?? true,
    intervalMin: c.intervalMin ?? 5,
    reports,
    now: NOW,
    timeZone: TZ,
    orgId: "o1",
    ackReady: c.ackReady ?? true,
  };
}

/* ---------------- home dashboard (/app/overview) ---------------- */

const widget = (id: string, key: string, title: string, layout: { w: number; h: number }, position: number, extra: Partial<DashboardWidgetRecord> = {}): DashboardWidgetRecord => {
  const sample = byKey(key)!;
  return {
    id,
    spec: { ...sample.spec, title } as DashboardWidgetRecord["spec"],
    sample: sample.data,
    layout: { x: 0, y: 0, ...layout },
    position,
    dataSourceId: extra.source ? extra.source.id : null,
    savedQueryId: null,
    refreshInterval: null,
    ...extra,
  };
};

// The services the board's widgets read from — a home board mixes every source, and one legacy
// snapshot widget has none.
const MY_PROD: WidgetSource = { id: "s1", name: "my-prod", engine: "supabase" };
const BILLING: WidgetSource = { id: "s2", name: "billing", engine: "mysql" };

const CORE: DashboardSummary = { id: "d-core", slug: "core-kpi", name: "핵심 KPI", pinned: true, position: 0 };
const GROWTH: DashboardSummary = { id: "d-growth", slug: "growth", name: "그로스 주간 지표", pinned: false, position: 1 };
const CORE_WIDGETS: DashboardWidgetRecord[] = [
  widget("w1", "kpi", "월 반복 매출 (MRR)", { w: 4, h: 3 }, 0, { source: MY_PROD, monitor: { alertId: "a1", status: "normal", enabled: true, lastCheckedAt: ago(3), via: "provenance" } }),
  widget("w2", "line", "일별 신규 가입", { w: 8, h: 4 }, 1, { source: MY_PROD, monitor: { alertId: "a2", status: "firing", enabled: true, lastCheckedAt: ago(4), openIncidentEventId: "e1", via: "provenance" } }),
  widget("w3", "bar", "월별 매출 추이", { w: 6, h: 4 }, 2, { source: BILLING }),
  widget("w4", "table", "지역별 매출", { w: 6, h: 4 }, 3, { source: null }),
];
/* one long service name per mark, for truncation */
const LONG_WIDGETS: DashboardWidgetRecord[] = CORE_WIDGETS.map((w) =>
  w.source ? { ...w, source: { ...w.source, name: `international-subscription-${w.source.name}-production-cluster` } } : w,
);
const board = (summary: DashboardSummary, widgets: DashboardWidgetRecord[]): DashboardDetail => ({ ...summary, widgets });

const PROPOSALS = (sourceId: string): ProposalPreview[] =>
  [
    ["일 매출", 5], ["결제 후 권한 미지급", 5], ["결제 실패율", 4], ["체험 → 유료 전환율", 4], ["활성 구독 수", 4], ["환불률", 3], ["주간 활성 사용자", 3], ["평균 주문 금액", 2],
  ].map(([title, importance], i) => ({ id: `k${i}`, title: String(title), importance: Number(importance), dataSourceId: sourceId }));

type HomeCase = {
  services: OverviewService[];
  /**
   * Activation inputs behind the home's onboarding checklist. Omitted → derived from the case
   * (no source = nothing done, any source = activated, i.e. no checklist); `null` = the read is
   * unavailable, which renders no checklist at all.
   */
  activation?: ActivationInputs | null;
  canManage?: boolean;
  canSetHome?: boolean;
  connectionPending?: boolean;
  boards?: DashboardSummary[];
  home?: DashboardSummary | null;
  /** why `home` is home (default: the AI-drafted core KPI board) */
  homeReason?: HomeReason | null;
  /** what Automatic would show (default: `home`) */
  autoHome?: DashboardSummary | null;
  board?: DashboardDetail | null;
  proposals?: ProposalPreview[];
};

const HOME_CASES: Record<string, HomeCase> = {
  new: { services: [] },
  "new-connected": { services: [], connectionPending: true },
  "new-viewer": { services: [], canManage: false },
  home: {
    services: [SVC.healthy],
    boards: [CORE, GROWTH], home: CORE, board: board(CORE, CORE_WIDGETS),
  },
  "home-chosen": {
    services: [SVC.healthy], canSetHome: true,
    boards: [CORE, GROWTH], home: GROWTH, homeReason: "chosen", autoHome: CORE,
    board: board(GROWTH, CORE_WIDGETS.slice(2).map((w, i) => ({ ...w, id: `g${i}`, position: i }))),
  },
  "home-viewer": {
    services: [SVC.incident], canManage: false,
    boards: [CORE], home: CORE, board: board(CORE, CORE_WIDGETS),
  },
  // the checklist above a real board: connected, understood, nothing approved yet
  "checklist-mid": {
    services: [SVC.proposals],
    activation: { realActiveSources: 1, reposAttached: 0, contextsGenerated: 1, kpisProposed: 8, kpisAccepted: 1, monitorsEnabled: 0, slackConnected: false, alertChannelConfigured: false },
    boards: [CORE], home: CORE, board: board(CORE, CORE_WIDGETS.slice(0, 2)),
    proposals: PROPOSALS("s1"),
  },
  "checklist-viewer": {
    services: [SVC.proposals],
    activation: { realActiveSources: 1, reposAttached: 0, contextsGenerated: 0, kpisProposed: 0, kpisAccepted: 0, monitorsEnabled: 0, slackConnected: false, alertChannelConfigured: false },
    canManage: false,
    proposals: PROPOSALS("s1"),
  },
  draft: { services: [SVC.proposals], proposals: PROPOSALS("s1") },
  "draft-viewer": { services: [SVC.proposals], canManage: false, proposals: PROPOSALS("s1") },
  analyzing: { services: [service({ name: "acme-prod" }, { scan: { context: "done", kpi: "running" } }), service({ id: "s2", name: "mobile-events", engine: "firestore" }, { scan: { context: "running", kpi: "pending" } })] },
  extract: { services: [service({ repoAttached: true })] },
  "empty-board": { services: [SVC.healthy], boards: [CORE], home: CORE, board: board(CORE, []) },
  long: {
    services: [service({ ...operating, name: "international-subscription-production-cluster", monitorCount: 3, monitorTotal: 3, monitors: HEALTHY.slice(0, 3) })],
    boards: [{ ...CORE, name: "International subscription entitlement consistency dashboard" }, GROWTH],
    home: { ...CORE, name: "International subscription entitlement consistency dashboard" },
    board: board({ ...CORE, name: "International subscription entitlement consistency dashboard" }, LONG_WIDGETS),
    canSetHome: true,
  },
};

const HOME_MODES = ["new", "new-connected", "new-viewer", "checklist-mid", "checklist-viewer", "home", "home-chosen", "home-viewer", "draft", "draft-viewer", "analyzing", "extract", "empty-board", "long"] as const;

function homeProps(c: HomeCase): OverviewViewProps {
  const activation =
    c.activation === null
      ? null
      : computeActivation(c.activation ?? (c.services.length === 0 ? { ...FRESH, realActiveSources: 0 } : ACTIVATED));
  return {
    orgId: "o1",
    activation,
    services: c.services,
    canManage: c.canManage ?? true,
    canSetHome: c.canSetHome ?? (c.canManage ?? true),
    connectionPending: c.connectionPending ?? false,
    boards: c.boards ?? [],
    home: c.home ?? null,
    homeReason: c.homeReason ?? (c.home ? "core" : null),
    autoHome: c.autoHome ?? c.home ?? null,
    board: c.board ?? null,
    proposals: c.proposals ?? [],
  };
}

/* Supabase projects for the picker: one connected, one waiting, one failed, one paused. */
const PROJECTS: SupabaseProjectChoice[] = [
  {
    ref: "abcdefghijklmnopqrst",
    name: "acme-prod",
    region: "ap-northeast-2",
    status: "ACTIVE_HEALTHY",
    bootstrappable: true,
    env: "production",
    state: "none",
    dataSourceId: null,
    errorCode: null,
    stages: { authorized: true, roleCreated: false, schemaScanned: false },
  },
  {
    ref: "bbcdefghijklmnopqrst",
    name: "acme-analytics",
    region: "us-east-1",
    status: "ACTIVE_HEALTHY",
    bootstrappable: true,
    env: "unknown",
    state: "active",
    dataSourceId: "ds2",
    errorCode: null,
    stages: { authorized: true, roleCreated: true, schemaScanned: true },
  },
  {
    ref: "ccdefghijklmnopqrstu",
    name: "acme-staging",
    region: "ap-northeast-2",
    status: "ACTIVE_HEALTHY",
    bootstrappable: true,
    env: "staging",
    state: "error",
    dataSourceId: "ds3",
    errorCode: "mint_readonly_role_failed",
    stages: { authorized: true, roleCreated: false, schemaScanned: false },
  },
  {
    ref: "ddefghijklmnopqrstuv",
    name: "old-sandbox",
    region: "eu-west-2",
    status: "INACTIVE",
    bootstrappable: false,
    env: "staging",
    state: "none",
    dataSourceId: null,
    errorCode: null,
    stages: { authorized: true, roleCreated: false, schemaScanned: false },
  },
];

/* /app/setup fixtures — mid-flow (stuck on the code step) and the completion card. */
const SETUP_BASE: Omit<SetupClientProps, "steps" | "nextStep" | "suggestions" | "completed"> = {
  orgId: "o1",
  firstSourceId: "s1",
  firstSourceName: "my-prod",
  repoName: "acme/webapp",
  slackChannel: "#founders",
  kpisAccepted: 5,
  monitorsEnabled: 3,
  scanStatus: null,
  hasRepo: true,
  intervalSec: 300,
  projects: [],
  showPicker: false,
  needsReconnect: false,
  canConfigure: true,
  slackAppConfigured: true,
  slackConnected: true,
  slackChannels: [
    { id: "C1", name: "founders" },
    { id: "C2", name: "general" },
    { id: "C3", name: "engineering" },
    { id: "C4", name: "alerts" },
  ],
  selectedSlackChannel: "C1",
};
const SETUP_MID: SetupClientProps = {
  ...SETUP_BASE,
  ...computeActivation(FRESH),
  repoName: null,
  kpisAccepted: 0,
  monitorsEnabled: 0,
};
const SETUP_DONE: SetupClientProps = {
  ...SETUP_BASE,
  ...computeActivation(ACTIVATED),
};
/* Authorized, nothing provisioned yet → the picker stands in for the connect step. */
const NOTHING: ActivationInputs = { ...FRESH, realActiveSources: 0 };
const SETUP_PICKER: SetupClientProps = {
  ...SETUP_BASE,
  ...computeActivation(NOTHING),
  projects: PROJECTS,
  showPicker: true,
  needsReconnect: false,
  firstSourceId: null,
  firstSourceName: null,
  repoName: null,
  kpisAccepted: 0,
  monitorsEnabled: 0,
};
/* Everything but the alert destination — the Slack step, with a workspace already connected. */
const SETUP_SLACK: SetupClientProps = {
  ...SETUP_BASE,
  ...computeActivation(ACTIVATED),
  // Activated, but alerts still go to email only → the completion view offers the Slack upgrade.
  slackChannel: null,
  slackConnected: true,
  selectedSlackChannel: null,
};

export default async function DevOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; view?: string; page?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const SETUP_VIEWS: Record<string, SetupClientProps> = {
    "setup-flow": SETUP_MID,
    "setup-done": SETUP_DONE,
    "setup-picker": SETUP_PICKER,
    "setup-slack": SETUP_SLACK,
  };
  const setupView = sp?.view ? SETUP_VIEWS[sp.view] : undefined;
  if (setupView) {
    return (
      <DashboardShell chrome={MOCK_CHROME}>
        <main>
          <SetupClient {...setupView} />
        </main>
      </DashboardShell>
    );
  }
  if (sp?.page === "reports") {
    const single = sp.mode && CASES[sp.mode] ? sp.mode : null;
    return (
      <DashboardShell chrome={MOCK_CHROME}>
        <main style={{ display: "flex", flexDirection: "column", gap: 96 }}>
          {(single ? [single] : REPORT_MODES).map((k) => (
            <section key={k} data-fixture={k}>
              {!single && <p style={{ margin: "0 0 12px", font: "12px var(--ax-mono)", color: "var(--ink-3)" }}>reports · {k}</p>}
              <ReportsView {...reportsProps(CASES[k])} />
            </section>
          ))}
        </main>
      </DashboardShell>
    );
  }
  const single = sp?.mode && HOME_CASES[sp.mode] ? sp.mode : null;

  return (
    <DashboardShell chrome={MOCK_CHROME}>
      <main style={{ display: "flex", flexDirection: "column", gap: 96 }}>
        {(single ? [single] : HOME_MODES).map((k) => (
          <section key={k} data-fixture={k}>
            {!single && <p style={{ margin: "0 0 12px", font: "12px var(--ax-mono)", color: "var(--ink-3)" }}>overview · {k}</p>}
            <OverviewView {...homeProps(HOME_CASES[k])} />
          </section>
        ))}
      </main>
    </DashboardShell>
  );
}
