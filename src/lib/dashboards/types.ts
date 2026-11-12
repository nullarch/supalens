/**
 * Domain types for saved dashboards. Hand-written (independent of the generated
 * Supabase `schema.type.ts`) so the UI + actions share one shape. The persisted
 * `spec` is the SAME VisualizationSpec the agent emits (src/lib/viz/spec.ts).
 */
import type { ChartSpec, VisualizationSpec, WidgetData } from '@/lib/viz/spec'
import type { MonitorLink, WidgetKpiDefinition } from './monitor-links'
import type { WidgetSource } from './widget-source'

export interface DashboardSummary {
  id: string
  slug: string
  name: string
  pinned: boolean
  position: number
}

/** Grid placement, persisted per widget (matches dashboard_widgets x/y/w/h). */
export interface GridLayout {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A persisted widget on a dashboard. `spec` is the agent's VisualizationSpec
 * envelope (or a bare ChartSpec for demo widgets); `sample` is an optional cached
 * result for instant render before any SQL re-run.
 */
export interface DashboardWidgetRecord {
  id: string
  spec: VisualizationSpec | ChartSpec
  sample: WidgetData | null
  layout: GridLayout
  position: number
  dataSourceId: string | null
  savedQueryId: string | null
  refreshInterval: number | null
  /** true when the live re-run failed AND no cached sample exists — render an error, not "empty". */
  liveError?: boolean
  /** The monitor watching this widget's metric, when one exists (see lib/dashboards/monitor-links). */
  monitor?: MonitorLink | null
  /** The verified KPI definition this widget came from (auto-KPI widgets only). */
  definition?: WidgetKpiDefinition | null
  /** The service the widget reads from (null = no data source; undefined = not resolved). */
  source?: WidgetSource | null
}

export interface DashboardDetail extends DashboardSummary {
  widgets: DashboardWidgetRecord[]
}

/** One org as the sidebar switcher needs it (client-safe). */
export interface OrgChrome {
  id: string
  name: string
  slug: string
  initials: string
  role: string
}

/** Sidebar/Topbar chrome data (client-safe shape; populated server-side by getAppChrome). */
export interface AppChrome {
  dashboards: DashboardSummary[]
  /** The board the Overview shows (chosen, else the core-KPI/pinned/first fallback) — the
   *  sidebar marks it "Home". Omitted/null when the workspace has no board. */
  homeDashboardId?: string | null
  /** `isAdmin` = the platform-staff flag (profiles.is_admin), NOT an org role. */
  user: { name: string; email: string; initials: string; isAdmin: boolean } | null
  /** The current (primary) org, or null when unauthenticated / no membership yet. */
  org: { id: string; name: string; initials: string } | null
  /** Every org the user belongs to, for the switcher dropdown. */
  orgs: OrgChrome[]
  /** Current-org plan + usage for the sidebar meter (null when unauthenticated). The meter
   *  shows MONITORS (alerts) against the plan cap — the product's value unit — not queries;
   *  query usage is kept for the billing page. */
  billing: {
    plan: string
    queriesUsed: number
    queriesLimit: number
    monitorsUsed: number
    monitorsLimit: number
  } | null
  /** Org-wide monitoring pulse for the topbar chip: how many monitors are currently enabled. */
  monitors: { enabled: number } | null
}

/** Persist payload for a single widget's grid placement (resize / drag). */
export interface WidgetLayoutPatch extends GridLayout {
  id: string
  position: number
}

/** Result shape for server actions that may be unavailable (Supabase unconfigured). */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unconfigured' | 'unauthorized' | 'not_found' | 'error'; message?: string }
