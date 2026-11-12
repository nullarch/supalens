import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import '@/app/app/dashboard.css'
import DashboardShell from '@/components/dashboard/DashboardShell'
import { PageHead } from '@/components/dashboard/PageHead'
import { AppSurface } from '@/components/dashboard/AppSurface'
import { MembersManager } from '@/app/app/settings/members/MembersManager'
import { NotificationsManager } from '@/app/app/settings/notifications/NotificationsManager'
import McpClient from '@/app/app/settings/developer/McpClient'
import { PlanCards } from '@/components/billing/PlanCards'
import type { AppChrome } from '@/lib/dashboards/types'
import { ControlsPreview } from './ControlsPreview'
import { SettingsView } from '@/app/app/settings/SettingsView'
import { PreferencesPreview } from './PreferencesPreview'
import { McpPreview } from './McpPreview'
import { NotificationsPreview } from './NotificationsPreview'
import { TeamPreview } from './TeamPreview'
import { IntegrationPreview } from './IntegrationPreview'
import { RepositoryPreview } from './RepositoryPreview'
import { DangerPreview } from './DangerPreview'

export const metadata = { title: 'Settings design fixtures', robots: { index: false, follow: false } }

const chrome: AppChrome = {
  dashboards: [],
  user: { name: 'Alex Morgan', email: 'alex@example.com', initials: 'AM', isAdmin: false },
  org: { id: 'fixture-org', name: 'Northstar', initials: 'NS' },
  orgs: [{ id: 'fixture-org', name: 'Northstar', slug: 'northstar', initials: 'NS', role: 'owner' }],
  billing: { plan: 'free', queriesUsed: 3, queriesLimit: 15, monitorsUsed: 2, monitorsLimit: 3 },
  monitors: { enabled: 2 },
}

/** Real components, fake props. Administrative previews are inert so even a
 * signed-in local browser cannot submit actions or copy credentials from here.
 * The controls fixture uses only local state; plans have billing disabled.
 * No auth bypass: this route is unavailable in production.
 */
export default async function SettingsPreview({ searchParams }: {
  searchParams: Promise<{ view?: string; role?: string; mode?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { view = 'workspace', role, mode = 'success' } = await searchParams
  if (view === 'danger-actions') {
    if (!['success', 'denied', 'subscription', 'unconfigured', 'unauthorized', 'failed', 'throw', 'malformed', 'partial', 'final-step', 'pending', 'handoff-failure', 'signout-failure', 'signout-pending', 'long', 'non-owner', 'empty-name'].includes(mode)) notFound()
    return <AppSurface><main style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 64px' }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24 }}>DESIGN FIXTURE · Local responses only. No deletion, sign-out, navigation or account changes.</p>
      <DangerPreview key={mode} mode={mode} />
    </main></AppSurface>
  }
  if (view === 'repository-actions') {
    if (!['success', 'failure', 'throw', 'malformed', 'pending', 'viewer', 'long', 'empty', 'refresh-failure', 'quota', 'trigger', 'server-error', 'stream-error', 'retry', 'banner-error', 'banner-cancel', 'banner-restart', 'banner-claimed', 'banner-import', 'banner-invalid'].includes(mode)) notFound()
    return <AppSurface><main style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 64px' }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24 }}>DESIGN FIXTURE · Local repository responses only. No analysis, GitHub changes, subscriptions or account writes.</p>
      <RepositoryPreview key={mode} mode={mode} />
    </main></AppSurface>
  }
  if (view === 'integration-actions') {
    if (!['success', 'failure', 'throw', 'malformed', 'pending', 'viewer', 'unavailable', 'empty', 'unlisted', 'long', 'refresh-failure'].includes(mode)) notFound()
    return <AppSurface><main style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 64px' }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24 }}>DESIGN FIXTURE · Local responses only. No external connection, provisioning, teardown or channel writes.</p>
      <IntegrationPreview key={mode} mode={mode} />
    </main></AppSurface>
  }
  if (view === 'team-actions') {
    if (!['success', 'admin', 'member', 'viewer', 'long', 'empty', 'failure', 'throw', 'malformed', 'pending', 'invite-fallback', 'copy-failure', 'copy-pending', 'refresh-failure'].includes(mode)) notFound()
    return <AppSurface><main style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 64px' }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24 }}>DESIGN FIXTURE · Sample members and local responses only. No invitations, membership changes, credential revocations or clipboard writes.</p>
      <TeamPreview key={mode} mode={mode} />
    </main></AppSurface>
  }
  if (view === 'notification-actions') {
    if (!['success', 'failure', 'throw', 'malformed', 'pending', 'none', 'email-only', 'channel-only', 'viewer', 'unavailable', 'disconnected', 'unconfigured', 'long', 'refresh-failure'].includes(mode)) notFound()
    return <AppSurface><main style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 64px' }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24 }}>DESIGN FIXTURE · Local responses only. No real webhook, email, connection or account changes. Slack connection controls are disabled.</p>
      <NotificationsPreview key={mode} mode={mode} />
    </main></AppSurface>
  }
  if (view === 'mcp-actions') {
    if (!['success', 'failure', 'throw', 'malformed', 'mint-refresh', 'revoke-refresh', 'copy-failed', 'pending', 'viewer', 'long', 'empty'].includes(mode)) notFound()
    return <AppSurface><main style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 64px' }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24 }}>DESIGN FIXTURE · Sample keys and local responses only. No network requests, real credentials, clipboard writes or account changes.</p>
      <McpPreview key={mode} mode={mode} />
    </main></AppSurface>
  }
  if (view === 'preferences') {
    if (!['success', 'failure', 'throw', 'malformed', 'unconfigured', 'viewer', 'migration', 'migration-response', 'long', 'refresh-failure', 'display-failure', 'locale-live', 'locale-live-failure', 'pending'].includes(mode)) notFound()
    return <AppSurface><main style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 64px' }}>
      <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 24 }}>DESIGN FIXTURE · Local settings responses only · No profile, workspace, email or account writes. Danger controls are disabled.</p>
      <PreferencesPreview key={mode} mode={mode} />
    </main></AppSurface>
  }
  const readOnly = role === 'viewer'
  const t = await getTranslations('appSettings')
  const tm = await getTranslations('appMembers')
  const tn = await getTranslations('appNotifications')
  const td = await getTranslations('appMcp')
  const tb = await getTranslations('appBilling')
  const interactive = view === 'controls' || view === 'plans'
  const tc = await getTranslations('appChrome')
  const titles: Record<string, string> = {
    workspace: tc('nav.settingsGeneral'), members: tm('page.title'), notifications: tn('title'),
    developer: td('title'), plans: tb('title'), controls: 'Shared controls — local interaction only',
  }
  const subtitles: Record<string, string | undefined> = {
    workspace: t('subtitle'), members: tm('page.subtitle'), notifications: tn('subtitle'), developer: td('subtitle'), plans: tb('subtitle'),
  }
  if (!titles[view]) notFound()
  const content = (
    <>
      <p style={{ color: 'var(--ink-3)', fontSize: 12, marginBottom: 20, lineHeight: 1.6 }}>
        DESIGN FIXTURE · Sample data · {interactive ? 'Local interaction only; billing disabled.' : 'Static preview; interactions disabled.'}
      </p>
      <PageHead title={titles[view]} subtitle={subtitles[view]} />
      <div inert={!interactive}>
        {view === 'workspace' && <SettingsView showHeading={false} orgId="fixture-org" name="Northstar" slug="northstar"
          timezone="America/Los_Angeles" pendingMigration={false} canEditOrg={!readOnly} isOwner={!readOnly}
          weeklyDigestEnabled={false} digestOptOut={false} alertOptOut={false} lifecycleOptOut />}
        {view === 'members' && <MembersManager orgId="fixture-org" meId="fixture-alex" myRole={readOnly ? 'viewer' : 'owner'} members={[
          { userId: 'fixture-alex', displayName: 'Alex Morgan', email: 'alex@example.com', role: readOnly ? 'viewer' : 'owner', joinedAt: '2026-08-12T10:00:00Z' },
          { userId: 'fixture-jordan', displayName: 'Jordan Lee', email: 'jordan.lee@example.com', role: 'member', joinedAt: '2026-09-01T10:00:00Z' },
        ]} invites={[{ id: 'fixture-invite', email: 'sam.engineering@example.com', role: 'member', createdAt: '2026-09-06T10:00:00Z', expiresAt: '2026-09-13T10:00:00Z' }]} />}
        {view === 'notifications' && <NotificationsManager canConfigure={!readOnly} slackAppConfigured targets={{ slackChannel: 'business-alerts', slackWebhook: false, discord: false, emailCount: 1 }} config={readOnly ? null : {
          slackWebhook: null, discordWebhook: null, slackConnected: true,
          slackChannels: [{ id: 'fixture-channel', name: 'business-alerts' }], selectedSlackChannel: 'fixture-channel',
          emailRecipients: [{ userId: 'fixture-alex', email: 'alex@example.com', role: 'owner', optedOut: false }],
        }} />}
        {view === 'developer' && <McpClient initialKeys={[]} endpoint="https://supalens.example/api/mcp" canManage={!readOnly} />}
        {view === 'plans' && <PlanCards currentPlan="free" billingConfigured={false} yearlyAvailable />}
        {view === 'controls' && <ControlsPreview />}
      </div>
    </>
  )
  return (
    <DashboardShell chrome={chrome}>
      {content}
    </DashboardShell>
  )
}
