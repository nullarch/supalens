'use server'

import { revalidatePath } from 'next/cache'
import { getLocale, getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { userHasOrgRole } from '@/lib/org/require-role'
import { ensureDraftBoard } from '@/lib/kpi/draft-board'
import type { ActionResult } from '@/lib/dashboards/types'

/**
 * "Build the draft dashboard" from the overview — the same draft the KPI extraction makes on its
 * own (lib/kpi/draft-board.ts), for a workspace whose extraction finished before drafts existed or
 * whose draft hit a transient fault. Member+ only (a viewer authoring a board is a write path), the
 * source must be a live, non-demo source the caller can see (RLS), and no LLM runs, so no usage gate.
 */
export async function createDraftDashboard(dataSourceId: string): Promise<ActionResult<{ slug: string; created: number }>> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, reason: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthorized' }
  const t = await getTranslations('appOverview')

  const { data } = await supabase.from('data_sources').select('org_id, is_demo').eq('id', dataSourceId).is('deleted_at', null).limit(1)
  const source = data?.[0] as { org_id: string; is_demo: boolean } | undefined
  if (!source || source.is_demo) return { ok: false, reason: 'not_found' }
  if (!(await userHasOrgRole(supabase, source.org_id, user.id, ['owner', 'admin', 'member']))) {
    return { ok: false, reason: 'error', message: t('home.empty.viewerNote') }
  }

  const result = await ensureDraftBoard({ orgId: source.org_id, dataSourceId, userId: user.id, locale: await getLocale() })
  revalidatePath('/app/overview')
  revalidatePath('/app/dashboards')
  if (result.ok) return { ok: true, data: { slug: result.dashboardSlug, created: result.created } }
  // The board already carries this source — nothing to draft, and nothing went wrong.
  if (result.reason === 'board_has_source') return { ok: true, data: { slug: result.dashboardSlug ?? 'core-kpi', created: 0 } }
  return { ok: false, reason: 'error', message: t(`home.empty.draftError.${result.reason}`) }
}
