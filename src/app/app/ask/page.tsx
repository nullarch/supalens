import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { ensurePrimaryOrg } from '@/lib/org/server'
import { ensureDemoSource } from '@/lib/data-sources/demo'
import { homeChecklistCoversOnboarding, shouldShowWizard, wizardMode } from '@/lib/onboarding/logic'
import { wizardSpec } from '@/lib/onboarding/wizard-specs'
import { AnalyzeClient } from '@/components/agent/AnalyzeClient'
import { AskEmptyState } from '@/components/agent/AskEmptyState'
import { OnboardingWizard, type WizardProps } from '@/components/onboarding/OnboardingWizard'
import s from './ask.module.css'

export const dynamic = 'force-dynamic'

export default async function AnalyzePage({
  searchParams,
}: {
  searchParams: Promise<{ wizard?: string }>
}) {
  const t = await getTranslations('appAsk')
  const supabase = await createClient()
  if (!supabase) {
    return <main className={s.unconfigured}>{t('supabaseNotConfigured')}</main>
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login?next=/app/ask')
  }

  // Provision the read-only demo source (idempotent, env-gated) so a brand-new user can try before
  // connecting their own DB.
  const orgId = await ensurePrimaryOrg(supabase, user)
  await ensureDemoSource(orgId)

  // Scoped to the ACTIVE workspace, not to RLS: RLS admits every org the caller belongs to, so a
  // member of two workspaces used to see both orgs' sources in one picker — and the run (and its
  // quota) is billed to the SOURCE's org, which let one workspace spend another's budget.
  const { data } = await supabase
    .from('data_sources')
    .select('id, name, is_demo, engine, provider, repo_id')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('is_demo', { ascending: true }) // real sources first, demo last
    .order('name', { ascending: true })
  const rows = (data ?? []) as {
    id: string
    name: string
    is_demo: boolean
    engine: string
    provider: string
    repo_id: string | null
  }[]

  // Provenance: which sources have a usable SUPALENS.md context (fresh/stale), and is it code-aware?
  const ctxMap: Record<string, 'schema' | 'code'> = {}
  if (rows.length > 0) {
    const { data: ctx } = await supabase
      .from('data_source_context')
      .select('data_source_id, source_repo_id, status')
      .in(
        'data_source_id',
        rows.map((r) => r.id),
      )
      .in('status', ['fresh', 'stale'])
    for (const c of (ctx ?? []) as { data_source_id: string; source_repo_id: string | null }[]) {
      ctxMap[c.data_source_id] = c.source_repo_id ? 'code' : 'schema'
    }
  }
  const dataSources = rows.map((r) => ({
    id: r.id,
    name: r.name,
    engine: r.engine,
    provider: r.provider,
    context: ctxMap[r.id],
    isDemo: r.is_demo,
    hasRepo: r.repo_id != null,
  }))

  // The demo source doesn't count as "connected your data" — the wizard needs the raw
  // `hasRealSources` shape for its tour/full branch. Activation state is NOT read here: the
  // setup checklist lives on the home screen only (one guide, not one per page).
  const realSources = rows.filter((r) => !r.is_demo).map((r) => ({ id: r.id, name: r.name }))
  const hasSources = realSources.length > 0
  const { count: runCount } = await supabase
    .from('agent_runs')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)

  // First-login wizard vs post-wizard pill. wizard_completed_at is the durable per-user flag
  // (localStorage can't cross devices); the run guard keeps anyone with activity out of it.
  const { data: prof } = await supabase
    .from('profiles')
    .select('wizard_completed_at')
    .eq('id', user.id)
    .limit(1)
  const wizardCompletedAt = prof?.[0]?.wizard_completed_at ?? null

  // A workspace with nothing connected is onboarded by the home checklist, not by an overlay
  // here: whoever can connect a database gets the checklist on /app/overview instead. The
  // invitee tour (a connected org someone just joined) is the only tour left.
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .limit(1)
  const homeOnboarding = homeChecklistCoversOnboarding({
    role: (memberRows?.[0] as { role?: string } | undefined)?.role,
    realSourceCount: realSources.length,
  })

  let wizard: WizardProps | null = null
  if (!homeOnboarding && shouldShowWizard({ wizardCompletedAt, runCount: runCount ?? 0 })) {
    const tDemo = await getTranslations('demo')
    // Canned demo-catalog spec clones (localized titles, samples inline) — Act 1 / Act 3-sample
    // render with zero queries and zero LLM.
    const spec = (key: string): unknown => wizardSpec(tDemo, key)
    const sp = await searchParams
    wizard = {
      mode: wizardMode({ hasRealSources: hasSources }),
      resume: sp?.wizard === 'resume',
      replayStatSpec: spec('total_revenue'),
      replayChartSpec: wizardSpec(tDemo, 'daily_revenue', { replay: true }),
      sampleSpecs: [spec('total_revenue'), spec('refund_rate'), spec('daily_revenue')].filter(Boolean),
      realSources,
      userId: user.id,
    }
  }
  // The chat surface (ChatGPT-style) owns its own top bar (new chat / history) and heading. It
  // carries NO setup guide: the remaining activation steps live on the home screen only.
  return (
    <div className={s.page} data-empty={dataSources.length === 0 || undefined}>
      {wizard && <OnboardingWizard {...wizard} />}

      {dataSources.length === 0 ? <AskEmptyState /> : <AnalyzeClient dataSources={dataSources} />}
    </div>
  )
}
