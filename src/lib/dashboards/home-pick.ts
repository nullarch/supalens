/**
 * Which board is the workspace's HOME — the one /app/overview shows. PURE (no io), so the page, the
 * dashboards index and the tests share one rule.
 *
 * Order: the board the workspace chose (organizations.home_dashboard_id) → the auto-KPI board
 * (slug core-kpi, which Supalens drafts right after KPI extraction) → the first pinned board → the
 * first board. A chosen id that no longer resolves (soft-deleted, another org) falls through.
 */

export interface HomeCandidate {
  id: string
  slug: string
  pinned: boolean
  position: number
}

export const CORE_KPI_SLUG = 'core-kpi'

export function pickHomeDashboard<T extends HomeCandidate>(dashboards: T[], chosenId: string | null): T | null {
  return resolveHome(dashboards, chosenId).home
}

/** Why a board is home — shown on the Overview so the choice is never a mystery. */
export type HomeReason = 'chosen' | 'core' | 'pinned' | 'first'

export interface HomeResolution<T> {
  home: T | null
  reason: HomeReason | null
  /** The board the automatic rule picks (ignoring any choice) — what "Automatic" would show. */
  auto: T | null
  /** The live chosen board's id, or null when nothing (live) is chosen. */
  chosenId: string | null
}

export function resolveHome<T extends HomeCandidate>(dashboards: T[], chosenId: string | null): HomeResolution<T> {
  if (dashboards.length === 0) return { home: null, reason: null, auto: null, chosenId: null }
  const core = dashboards.find((d) => d.slug === CORE_KPI_SLUG)
  const ordered = [...dashboards].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position)
  const auto = core ?? ordered[0]
  const autoReason: HomeReason = core ? 'core' : ordered[0].pinned ? 'pinned' : 'first'
  const chosen = chosenId ? dashboards.find((d) => d.id === chosenId) : undefined
  return chosen
    ? { home: chosen, reason: 'chosen', auto, chosenId: chosen.id }
    : { home: auto, reason: autoReason, auto, chosenId: null }
}
