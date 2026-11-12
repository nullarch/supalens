'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AcceptForm } from '@/app/app/invite/[token]/AcceptForm'
import { InvitationFailure, InvitationReady, InvitationShell } from '@/app/app/invite/[token]/InvitationShell'

export function InvitationPreview({ mode }: { mode: string }) {
  const t = useTranslations('appMembers')
  const [token, setToken] = useState('sample-invite-A')
  const [calls, setCalls] = useState<unknown[]>([])
  const acceptAttempts = useRef(0)
  const navigationAttempts = useRef(0)
  const releaseAccept = useRef<() => void>(() => {})
  const releaseNavigation = useRef<() => void>(() => {})
  const record = (value: unknown) => setCalls(previous => [...previous, value])
  const name = token === 'sample-invite-B' ? 'Harbor' : mode === 'long' ? 'Northstar / 글로벌 日本語 Workspace '.repeat(25) : 'Northstar'
  const failure = ({ expired: 'expired', processed: 'processed', missing: 'notFound', mismatch: 'mismatch' } as const)[mode as 'expired' | 'processed' | 'missing' | 'mismatch']
  return <>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
      <button type="button" className="dx-btn-ghost dx-btn-sm" onClick={() => setToken('sample-invite-B')}>Switch sample invitation</button>
      <button type="button" className="dx-btn-ghost dx-btn-sm" onClick={() => releaseAccept.current()}>Resolve local acceptance</button>
      <button type="button" className="dx-btn-ghost dx-btn-sm" onClick={() => releaseNavigation.current()}>Resolve local navigation</button>
      <button type="button" className="dx-btn-ghost dx-btn-sm" data-external-focus>Outside focus target</button>
    </div>
    {mode === 'unconfigured' ? <InvitationShell title={t('supabaseNotConfigured')} />
      : mode === 'preview-unavailable' ? <InvitationFailure title={t('accept.previewTitle')} message={t('accept.previewUnavailable')} home={t('accept.home')} onHome={() => record('home')}
        retry={{ href: '/dev/invitations?mode=success', label: t('accept.reload'), onRetry: () => record('reload') }} />
      : failure ? <InvitationFailure title={t('accept.cannotAccept')} message={failure === 'mismatch'
        ? t('accept.mismatch', { invited: 'in******@example.invalid', current: 'current-account-name'.repeat(12) + '@example.invalid' })
        : t(`accept.${failure}`)} home={t('accept.home')} onHome={() => record('home')} />
      : <InvitationReady title={t('accept.joinTitle', { org: name })} description={t('accept.invitedTo', { org: name, role: t('role.member') })}>
        <AcceptForm token={token} io={{
          accept: async currentToken => {
            record({ action: 'accept', token: currentToken })
            const attempt = acceptAttempts.current++
            if (mode === 'pending' || mode === 'stale') await new Promise<void>(resolve => { releaseAccept.current = resolve })
            else await new Promise(resolve => setTimeout(resolve, 100))
            if (mode === 'throw' || mode === 'reload-failed') throw new Error('PRIVATE_RPC_SENTINEL')
            if (mode === 'malformed') return { ok: 'true', message: 'PRIVATE_RPC_SENTINEL' }
            if (mode === 'missing-org') return { ok: true, data: { orgId: '' } }
            if (mode === 'unauthorized' || mode === 'unavailable') return { ok: false, reason: mode === 'unauthorized' ? 'unauthorized' : 'unconfigured' }
            if (mode === 'rejected' || (mode === 'retry' && attempt === 0)) return { ok: false, reason: 'error', message: 'PRIVATE_RPC_SENTINEL' }
            return { ok: true, data: { orgId: `org-for-${currentToken}` } }
          },
          navigate: async () => {
            record('navigate-members')
            if (mode === 'navigation-pending') await new Promise<void>(resolve => { releaseNavigation.current = resolve })
            if (mode === 'navigation-failed' && navigationAttempts.current++ === 0) throw new Error('PRIVATE_NAVIGATION_SENTINEL')
          },
          reload: () => { record('reload'); if (mode === 'reload-failed') throw new Error('PRIVATE_RELOAD_SENTINEL') },
          home: () => record('home'),
        }} />
      </InvitationReady>}
    <details style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)' }}><summary className="dx-label" style={{ cursor: 'pointer' }}>Local fixture calls</summary><output data-invitation-calls style={{ overflowWrap: 'anywhere' }}>{JSON.stringify(calls)}</output></details>
  </>
}
