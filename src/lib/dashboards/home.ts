import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { isMissingColumnError } from '@/lib/agent/run-channel'
import { resolveHome, type HomeReason } from './home-pick'
import type { DashboardSummary } from './types'

export interface HomeDashboardState {
  /** Every live board of the workspace, in list order. */
  dashboards: DashboardSummary[]
  /** The board /app/overview shows, or null when the workspace has none. */
  home: DashboardSummary | null
  /** The workspace explicitly chose `home` (vs. the fallback rule). */
  chosen: boolean
  /** Why `home` is home: chosen, or which automatic rule picked it. */
  reason: HomeReason | null
  /** The board "Automatic" resolves to. */
  auto: DashboardSummary | null
  /** `organizations.home_dashboard_id` exists — false before the migration, which hides "set as home". */
  settable: boolean
}

/**
 * The workspace's boards and its home board, read through the user-JWT client (RLS scopes both
 * tables to the caller's orgs). Fail-open ONLY for the unapplied home-dashboard migration; any other
 * read fault throws to the route's error boundary, like the rest of the overview reads.
 */
export async function getHomeDashboardState(supabase: SupabaseClient, orgId: string): Promise<HomeDashboardState> {
  const [boards, org] = await Promise.all([
    supabase
      .from('dashboards')
      .select('id, slug, name, pinned, position')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
    supabase.from('organizations').select('home_dashboard_id').eq('id', orgId).limit(1),
  ])
  if (boards.error) throw Object.assign(new Error(`[home] dashboards read failed: ${boards.error.message}`), { code: boards.error.code })
  let settable = true
  let chosenId: string | null = null
  if (org.error) {
    if (!isMissingColumnError(org.error)) throw Object.assign(new Error(`[home] organization read failed: ${org.error.message}`), { code: org.error.code })
    settable = false
  } else {
    chosenId = (org.data?.[0] as { home_dashboard_id?: string | null } | undefined)?.home_dashboard_id ?? null
  }
  const dashboards = (boards.data ?? []) as DashboardSummary[]
  const resolved = resolveHome(dashboards, chosenId)
  return { dashboards, home: resolved.home, chosen: resolved.reason === 'chosen', reason: resolved.reason, auto: resolved.auto, settable }
}
