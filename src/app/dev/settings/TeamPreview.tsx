'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MembersManager, type TeamActions } from '@/app/app/settings/members/MembersManager'
import type { MemberRow, InvitationRow } from '@/lib/org/server'

/** Local callbacks only. Never invite, remove, transfer, leave or write the OS clipboard. */
export function TeamPreview({ mode }: { mode: string }) {
  const t = useTranslations('appMembers')
  const initialRole = ['admin', 'member', 'viewer'].includes(mode) ? mode : 'owner'
  const [myRole, setMyRole] = useState(initialRole)
  const [members, setMembers] = useState<MemberRow[]>(mode === 'empty' ? [] : [
    { userId: 'sample-me', displayName: 'Alex Morgan', email: 'alex@example.com', role: initialRole, joinedAt: '2026-09-01T00:00:00Z' },
    { userId: 'sample-jordan', displayName: mode === 'long' ? 'Long Sample Member Name '.repeat(12) : 'Jordan Lee', email: 'jordan@example.com', role: 'member', joinedAt: mode === 'long' ? 'invalid' : '2026-09-02T00:00:00Z' },
    { userId: 'sample-admin', displayName: 'Sam Park', email: 'sam@example.com', role: 'admin', joinedAt: '2026-09-02T00:00:00Z' },
  ])
  const [invites, setInvites] = useState<InvitationRow[]>(mode === 'empty' ? [] : [{
    id: 'sample-invite', email: mode === 'long' ? `${'sample-long-address-'.repeat(12)}@example.com` : 'pending@example.com', role: 'member', createdAt: '2026-09-01T00:00:00Z', expiresAt: '2026-09-14T00:00:00Z',
  }])
  const stored = useRef({ members, invites, myRole })
  const [calls, setCalls] = useState<string[]>([])
  const respond = async (name: string, update?: () => void) => {
    setCalls(previous => [...previous, name])
    await new Promise(resolve => setTimeout(resolve, mode === 'pending' ? 700 : 50))
    if (mode === 'throw') throw new Error('Simulated action failure')
    if (mode === 'failure') return { ok: false, message: t('toast.actionFailed') }
    if (mode === 'malformed') return name === 'invite' ? { ok: true, data: { emailSent: 'true' } } : {}
    update?.()
    return name === 'invite' ? { ok: true, data: {
      token: 'sample-only', emailSent: !['invite-fallback', 'copy-failure', 'copy-pending'].includes(mode),
      link: 'https://supalens.example/app/invite/sample-only',
    } } : { ok: true }
  }
  const actions: TeamActions = {
    inviteMember: (_org, email, role) => respond('invite', () => { stored.current.invites = [...stored.current.invites, { id: 'sample-new-invite', email, role, createdAt: '2026-09-07T00:00:00Z', expiresAt: '2026-09-14T00:00:00Z' }] }),
    updateMemberRole: (_org, userId, role) => respond('role', () => { stored.current.members = stored.current.members.map(m => m.userId === userId ? { ...m, role } : m) }),
    removeMember: (_org, userId) => respond('remove', () => { stored.current.members = stored.current.members.filter(m => m.userId !== userId) }),
    leaveOrg: () => respond('leave', () => { stored.current.members = stored.current.members.filter(m => m.userId !== 'sample-me'); stored.current.myRole = 'viewer' }),
    transferOwnership: (_org, userId) => respond('transfer', () => {
      stored.current.members = stored.current.members.map(m => m.userId === userId ? { ...m, role: 'owner' } : m.userId === 'sample-me' ? { ...m, role: 'admin' } : m)
      stored.current.myRole = 'admin'
    }),
    revokeInvitation: inviteId => respond('revoke', () => { stored.current.invites = stored.current.invites.filter(i => i.id !== inviteId) }),
  }
  return <>
    <MembersManager orgId="sample-org" meId="sample-me" myRole={myRole} members={members} invites={invites} actions={actions}
      reloadHref="/dev/settings?view=team-actions&mode=success"
      refresh={() => {
        setCalls(previous => [...previous, 'refresh'])
        if (mode === 'refresh-failure') throw new Error('Simulated refresh failure')
        setMembers(stored.current.members); setInvites(stored.current.invites); setMyRole(stored.current.myRole)
      }}
      copy={async () => {
        setCalls(previous => [...previous, 'copy'])
        await new Promise(resolve => setTimeout(resolve, mode === 'copy-pending' ? 700 : 50))
        if (mode === 'copy-failure') throw new Error('Simulated clipboard failure')
      }} />
    <details style={{ marginTop: 24 }}><summary>Local fixture calls (no invitation tokens)</summary><output data-team-calls>{JSON.stringify(calls)}</output></details>
  </>
}
