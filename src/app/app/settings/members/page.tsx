import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/utils/supabase/server'
import { ensurePrimaryOrg, listOrgMembers, listPendingInvitations } from '@/lib/org/server'
import { PageHead } from '@/components/dashboard/PageHead'
import { MembersManager } from './MembersManager'

export const dynamic = 'force-dynamic'

export default async function TeamPage() {
  const t = await getTranslations('appMembers')
  const supabase = await createClient()
  if (!supabase) {
    return <div style={{ padding: 40 }}>{t('supabaseNotConfigured')}</div>
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login?next=/app/settings/members')
  }

  const orgId = await ensurePrimaryOrg(supabase, user)
  const members = await listOrgMembers(supabase, orgId)
  const invites = await listPendingInvitations(supabase, orgId)
  const myRole = members.find((m) => m.userId === user.id)?.role ?? 'member'

  return (
    <div>
      <PageHead title={t('page.title')} subtitle={t('page.subtitle')} />

      <MembersManager
        key={orgId}
        orgId={orgId}
        meId={user.id}
        myRole={myRole}
        members={members}
        invites={invites}
      />
    </div>
  )
}
