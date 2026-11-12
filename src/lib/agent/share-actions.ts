'use server'

import { appOrigin } from '@/config/edition'
import { randomUUID } from 'crypto'

import { createClient } from '@/utils/supabase/server'
import { requireAdminClient } from '@/utils/supabase/admin'

/**
 * Create (or reuse) a public share link for an analysis run. Auth = RLS: agent_runs is
 * member-readable, so the visibility SELECT returns the row only if the caller is a member
 * of the run's org. The token is unguessable; the public page exposes only that one answer.
 */
export async function shareRun(runId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  if (!supabase) return { ok: false, error: 'unconfigured' }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  const { data: runRows } = await supabase.from('agent_runs').select('id, org_id').eq('id', runId).limit(1)
  if (!runRows || runRows.length === 0) return { ok: false, error: '분석 결과를 찾을 수 없습니다' }
  // Publishing org data to a public URL is member+ only — a viewer must not be an exfil channel
  // (mirrors the alerts write boundary).
  const orgId = (runRows[0] as { org_id: string }).org_id
  const { data: mem } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .limit(1)
  const role = (mem?.[0] as { role: string } | undefined)?.role
  if (!role || role === 'viewer') return { ok: false, error: '공유 권한이 없습니다 (뷰어는 공유할 수 없습니다)' }

  const admin = requireAdminClient()
  const { data: existing } = await admin.from('agent_runs').select('share_token').eq('id', runId).limit(1)
  let token = (existing?.[0] as { share_token: string | null } | undefined)?.share_token ?? null
  if (!token) {
    token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8)
    const { error } = await admin.from('agent_runs').update({ share_token: token }).eq('id', runId)
    if (error) return { ok: false, error: error.message }
  }

  const base = appOrigin()
  return { ok: true, url: `${base}/share/${token}` }
}

/** Revoke a run's public share link (clears the token). RLS confirms org membership; the role
 *  gate mirrors shareRun — a viewer must not be able to invalidate links members published. */
export async function unshareRun(runId: string): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  if (!supabase) return { ok: false }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false }
  const { data: runRows } = await supabase.from('agent_runs').select('id, org_id').eq('id', runId).limit(1)
  if (!runRows || runRows.length === 0) return { ok: false }
  const orgId = (runRows[0] as { org_id: string }).org_id
  const { data: mem } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .limit(1)
  const role = (mem?.[0] as { role: string } | undefined)?.role
  if (!role || role === 'viewer') return { ok: false }
  const admin = requireAdminClient()
  const { error } = await admin.from('agent_runs').update({ share_token: null }).eq('id', runId)
  return { ok: !error }
}
