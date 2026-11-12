import { notFound } from 'next/navigation'

import '@/app/app/dashboard.css'
import '@/components/landing/editorial/editorial.css'
import { editorialFontVariables } from '@/components/landing/editorial/fonts'
import DashboardShell from '@/components/dashboard/DashboardShell'
import { PageHead } from '@/components/dashboard/PageHead'
import { OnboardingModalGate } from '@/components/onboarding/OnboardingModalGate'
import type { AppChrome } from '@/lib/dashboards/types'

// Dev-only PREVIEW of the onboarding modal, mounted by the real gate over the real shell.
// The /app shell no longer mounts it: onboarding is one non-blocking checklist on the home
// screen (src/app/app/overview/SetupChecklist.tsx). This gallery keeps the component alive for
// design review only. Dismissal is per browser — clear localStorage
// `supalens.onboardingModal.dismissed.sample-org` to see it again.
export const metadata = { title: 'Onboarding modal fixture', robots: { index: false, follow: false } }

const CHROME: AppChrome = {
  dashboards: [],
  user: { name: 'Sample Person', email: 'sample@example.invalid', initials: 'SP', isAdmin: false },
  org: { id: 'sample-org', name: 'Northstar', initials: 'NS' },
  orgs: [{ id: 'sample-org', name: 'Northstar', slug: 'northstar', initials: 'NS', role: 'owner' }],
  billing: null,
  monitors: { enabled: 0 },
}

export default function OnboardingModalFixture() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <DashboardShell chrome={CHROME}>
      <main>
        <PageHead title="Overview" subtitle="Sample workspace with nothing connected" />
      </main>
      <OnboardingModalGate orgId={CHROME.org!.id} fontClassName={editorialFontVariables} />
    </DashboardShell>
  )
}
