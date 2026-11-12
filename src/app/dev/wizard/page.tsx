import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import '@/app/app/dashboard.css' // global tokens the wizard/widgets style off
import { wizardSpec } from '@/lib/onboarding/wizard-specs'
import { SlackPreview, WizardPreview } from './OnboardingPreview'
import { SetupPill } from '@/components/onboarding/SetupPill'
import { computeActivation, type ActivationInputs } from '@/lib/activation/logic'
import { AnalyzeClient } from '@/components/agent/AnalyzeClient'
import { SetupClient } from '@/app/app/setup/SetupClient'
import { AskEmptyState } from '@/components/agent/AskEmptyState'
import { AppSurface } from '@/components/dashboard/AppSurface'

// Dev-only preview of the 4-act onboarding wizard. Real wizard actions must be intercepted
// by browser tests; a signed-in session could otherwise perform real mutations. notFound() in production,
// same as the widgets gallery.   npm run dev → http://localhost:3000/dev/wizard
//   ?mode=tour     — invitee short tour (act 1 only)
//   ?connected=1&resume=1 — start at code attachment; act 4 offers extraction
//   ?view=slack&state=partial — local action adapter; no server actions or messages
//   ?view=pill     — epilogue SetupPill states (no overlay)
//   ?view=ask      — /app/ask empty state with the demo example-question chips (no overlay)

export const metadata = { robots: { index: false } }
const EXTRACTION_OUTCOMES = ['success', 'pending', 'running', 'quota', 'rejected', 'conflict', 'unavailable', 'unknown-server', 'throw', 'malformed', 'retry', 'complete-throw']

/* SetupPill fixtures — a brand-new org, and one that connected a DB but stopped there. */
const PILL_FRESH: ActivationInputs = {
  realActiveSources: 0,
  reposAttached: 0,
  contextsGenerated: 0,
  kpisProposed: 0,
  kpisAccepted: 0,
  monitorsEnabled: 0,
  slackConnected: false,
  alertChannelConfigured: false,
}
const PILL_MID: ActivationInputs = { ...PILL_FRESH, realActiveSources: 1, reposAttached: 1 }

export default async function DevWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; connected?: string; view?: string; resume?: string; state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  if (sp.view === 'extract-actions' && !EXTRACTION_OUTCOMES.includes(sp.state ?? 'success')) notFound()
  const t = await getTranslations('demo')

  // Every view here is an /app surface mounted without DashboardShell → AppSurface provides the scope.
  if (sp?.view === 'slack') return <AppSurface><SlackPreview mode={sp.state ?? 'success'} /></AppSurface>
  if (sp?.view === 'setup') {
    const complete = sp.state === 'complete' || sp.state === 'complete-slack'
    const fresh = sp.state === 'fresh'
    const inputs: ActivationInputs = {
      ...PILL_FRESH, realActiveSources: fresh ? 0 : 1,
      reposAttached: fresh ? 0 : 1, contextsGenerated: fresh ? 0 : 1,
      kpisProposed: fresh ? 0 : 8, kpisAccepted: complete ? 8 : 0,
      monitorsEnabled: complete ? 3 : 0, alertChannelConfigured: complete,
    }
    const activation = computeActivation(inputs)
    return <AppSurface><main style={{ padding: '32px 20px', maxWidth: 800, margin: '0 auto' }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7, marginBottom: 20 }}>DESIGN FIXTURE · Sample activation states. All interactions disabled; no scan, save or notification is performed.</p>
      <div inert>
        <SetupClient {...activation} orgId="fixture-org" firstSourceId={fresh ? null : 'fixture-source'}
          firstSourceName="international-subscription-entitlement-processing-production" repoName="northstar/analytics-worker"
          slackChannel={sp.state === 'complete' ? '#business-alerts' : null}
          kpisAccepted={inputs.kpisAccepted} monitorsEnabled={inputs.monitorsEnabled}
          scanStatus={null} hasRepo={!fresh} intervalSec={7200} projects={[]} showPicker={false} needsReconnect={false}
          canConfigure={false} slackAppConfigured slackConnected={false} slackChannels={[]} selectedSlackChannel={null} />
      </div>
    </main></AppSurface>
  }

  if (sp?.view === 'pill') {
    return (
      <AppSurface>
        <div style={{ minHeight: '100dvh', padding: '48px 24px' }}>
          <div style={{ maxWidth: 768, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <p className="dx-label">DESIGN FIXTURE · Local dismissal only. Setup links are not submitted by verification.</p>
            <SetupPill steps={computeActivation(PILL_FRESH).steps} nextStep={computeActivation(PILL_FRESH).nextStep} />
            <SetupPill steps={computeActivation(PILL_MID).steps} nextStep={computeActivation(PILL_MID).nextStep} />
          </div>
        </div>
      </AppSurface>
    )
  }
  if (sp?.view === 'ask-empty') return <AppSurface><main style={{ padding: '48px 20px' }}><AskEmptyState /></main></AppSurface>
  if (sp?.view === 'ask') {
    return (
      <AppSurface>
        <div style={{ minHeight: '100dvh', padding: '48px 24px' }}>
          <AnalyzeClient dataSources={[{ id: 'dev-demo', name: '데모 · 이커머스 샘플', engine: 'postgres', provider: 'neon', isDemo: true, hasRepo: false }]} />
        </div>
      </AppSurface>
    )
  }

  const spec = (key: string): unknown => wizardSpec(t, key)

  return (
    <AppSurface>
      <WizardPreview
        mode={sp?.mode === 'tour' ? 'tour' : 'full'}
        resume={sp?.resume === '1' || sp.view === 'extract-actions'}
        outcome={sp.state ?? 'success'}
        replayStatSpec={spec('total_revenue')}
        replayChartSpec={wizardSpec(t, 'daily_revenue', { replay: true })}
        sampleSpecs={[spec('total_revenue'), spec('refund_rate'), spec('daily_revenue')].filter(Boolean)}
        realSources={sp?.connected === '1' || sp.view === 'extract-actions' ? [{ id: 'dev-fixture', name: 'international-subscription-entitlement-processing-production' }] : []}
      />
    </AppSurface>
  )
}
