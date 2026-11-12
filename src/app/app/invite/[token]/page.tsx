import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { AcceptForm } from './AcceptForm'
import { InvitationShell as Shell, InvitationFailure as Failure, InvitationReady } from './InvitationShell'
import { readInvitationPreview, type InvitePreview } from './invitation-preview'

export const dynamic = 'force-dynamic'

/** Shown to a mismatched account — don't reveal the full invited address. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`
}

/**
 * Invitation accept landing. The invitee opens /app/invite/<token>; middleware
 * bounces them to /login first if signed out. Once authenticated, the page
 * previews the invitation (org, role) and the accept only happens when the
 * invitee explicitly confirms — accepting is a mutation and must not run as a
 * GET side effect (see AcceptForm).
 */
export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const t = await getTranslations('appMembers')

  const supabase = await createClient()
  if (!supabase) {
    return <Shell title={t('supabaseNotConfigured')} />
  }
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/login?next=/app/invite/${token}`)
  }

  // Preview via the service-role client: the invitee is by definition not yet a
  // member, so the owner/admin-only RLS on invitations can't serve them —
  // possession of the unguessable token is the read authorization here.
  const admin = createAdminClient()
  const unavailable = () => <Failure title={t('accept.previewTitle')} message={t('accept.previewUnavailable')} home={t('accept.home')}
    retry={{ href: `/app/invite/${encodeURIComponent(token)}`, label: t('accept.reload') }} />
  if (!admin) return unavailable()
  let inv: InvitePreview | null
  try { inv = await readInvitationPreview(admin, token) }
  catch { return unavailable() }

  // The RPC still re-checks membership/expiry/account authoritatively on POST.
  if (!inv || !inv.organizations || inv.organizations.deleted_at) {
    return <Failure title={t('accept.cannotAccept')} message={t('accept.notFound')} home={t('accept.home')} />
  }
  if (inv.status !== 'pending') {
    return <Failure title={t('accept.cannotAccept')} message={t('accept.processed')} home={t('accept.home')} />
  }
  if (new Date(inv.expires_at) < new Date()) {
    return <Failure title={t('accept.cannotAccept')} message={t('accept.expired')} home={t('accept.home')} />
  }
  if (inv.email.toLowerCase() !== (user.email ?? '').toLowerCase()) {
    return <Failure title={t('accept.cannotAccept')}
      message={t('accept.mismatch', { invited: maskEmail(inv.email), current: user.email ?? '?' })}
      home={t('accept.home')} />
  }
  return (
    <InvitationReady title={t('accept.joinTitle', { org: inv.organizations.name })} description={t('accept.invitedTo', {
      org: inv.organizations.name,
      role: t(`role.${inv.role}`),
    })}>
      <AcceptForm token={token} />
    </InvitationReady>
  )
}
