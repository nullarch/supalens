import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { createClient } from '@/utils/supabase/server'
import { listOrgs, ACTIVE_ORG_COOKIE } from '@/lib/org/server'
import { getActiveJobs } from '@/lib/jobs/active'

export const dynamic = 'force-dynamic'

/**
 * Sidebar polling endpoint: the ACTIVE org's currently-running async jobs
 * (analysis / code / KPI extraction / context generation). Read-only, RLS-scoped
 * through the caller's user JWT — no LLM, no quota gate needed.
 */
export async function GET() {
  const supabase = await createClient()
  if (!supabase) return NextResponse.json({ jobs: [] })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // same active-org resolution as getAppChrome: cookie pick, else first membership
  const orgs = await listOrgs(supabase)
  const activeId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value
  const org = (activeId ? orgs.find((o) => o.id === activeId) : null) ?? orgs[0] ?? null
  if (!org) return NextResponse.json({ jobs: [] })

  const jobs = await getActiveJobs(supabase, org.id)
  return NextResponse.json({ jobs })
}
