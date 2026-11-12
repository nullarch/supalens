'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'

import {
  inviteMember,
  updateMemberRole,
  removeMember,
  leaveOrg,
  transferOwnership,
  revokeInvitation,
  type AssignableRole,
} from '@/lib/org/actions'
import type { MemberRow, InvitationRow } from '@/lib/org/server'
import { Select } from '@/components/ui/Select'
import { BaseModal, ModalButton } from '@/components/modals'
import { settingsSaveResult } from '../save-result'
import { captureSettingsFocus, restoreSettingsFocus } from '../settings-focus'
import { isSelfHosted } from '@/config/edition'
import { inviteResult } from './invite-result'
import { InternalAccounts } from './InternalAccounts'
import s from './team.module.css'

const defaultActions = { inviteMember, updateMemberRole, removeMember, leaveOrg, transferOwnership, revokeInvitation }
export type TeamActions = { [K in keyof typeof defaultActions]: (...args: Parameters<typeof defaultActions[K]>) => Promise<unknown> }
type Confirmation = { kind: 'remove' | 'transfer' | 'leave' | 'revoke'; targetId: string; name: string }
const copyText = (value: string) => navigator.clipboard.writeText(value)

const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1, viewer: 0 }

/** Roles a caller of the given role may assign (strictly below them, never owner). */
function assignableRoles(myRole: string): AssignableRole[] {
  const all: AssignableRole[] = ['admin', 'member', 'viewer']
  return all.filter((r) => ROLE_RANK[r] < ROLE_RANK[myRole])
}

function initialsOf(name: string | null, email: string | null): string {
  const base = (name ?? email ?? '?').trim()
  return base.slice(0, 2).toUpperCase()
}

export function MembersManager({
  orgId,
  meId,
  myRole,
  members,
  invites,
  actions = defaultActions,
  refresh,
  copy = copyText,
  reloadHref = '/app/settings/members',
}: {
  orgId: string
  meId: string
  myRole: string
  members: MemberRow[]
  invites: InvitationRow[]
  actions?: TeamActions
  refresh?: () => void
  copy?: typeof copyText
  reloadHref?: string
}) {
  const t = useTranslations('appMembers')
  const common = useTranslations('appCommon')
  const locale = useLocale()
  const dateLabel = (value: string) => Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value))
    : t('unknownDate')
  const id = useId()
  const roleLabel = (r: string) =>
    r === 'owner' || r === 'admin' || r === 'member' || r === 'viewer' ? t(`role.${r}`) : r
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err' | 'info'; text: string; link?: string } | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)
  const [needsReview, setNeedsReview] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  const origin = useRef<ReturnType<typeof captureSettingsFocus> | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const modalTrigger = useRef<HTMLButtonElement | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle')
  const copying = useRef(false)
  const copyEpoch = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!pending) { restoreSettingsFocus(origin.current); origin.current = null } }, [pending])
  useEffect(() => {
    const epoch = ++copyEpoch.current
    copying.current = false
    setCopyState('idle')
    return () => { copyEpoch.current = epoch + 1 }
  }, [notice?.link])

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<AssignableRole>('member')

  const canManage = myRole === 'owner' || myRole === 'admin'
  // Self-hosted: accounts are created here by an admin; invitations (email + public sign-up) and
  // leaving the only workspace do not apply.
  const selfHosted = isSelfHosted()
  const myRank = ROLE_RANK[myRole] ?? 0
  const options = assignableRoles(myRole)

  /** Lazy callbacks prevent a request from starting before the shared busy guard. */
  async function run(action: () => Promise<unknown>, okText: string, options?: { modal?: boolean; email?: string }) {
    if (locked.current || needsReview) return
    locked.current = true
    origin.current = captureSettingsFocus()
    setPending(true)
    setNotice(null)
    setModalError(null)
    let response: unknown
    try { response = await action() } catch { response = undefined }
    if (!mounted.current) { locked.current = false; return }
    const outcome = settingsSaveResult(response)
    const invitation = options?.email ? inviteResult(response) : null
    const uncertain = outcome.kind === 'unconfirmed' || (outcome.kind === 'confirmed' && !!options?.email && !invitation)
    if (uncertain || outcome.kind !== 'confirmed') {
      const text = uncertain ? t('unconfirmed') : outcome.message ?? t('toast.actionFailed')
      if (uncertain) setNeedsReview(true)
      if (options?.modal) setModalError(text)
      else setNotice({ kind: 'err', text })
    } else {
      setNotice(invitation && options?.email ? invitation.emailSent
        ? { kind: 'ok', text: t('invite.sent', { email: options.email }) }
        : { kind: 'info', text: t('invite.sendFailedLink', { email: options.email }), link: invitation.link }
        : { kind: 'ok', text: okText })
      if (options?.email) setInviteEmail('')
      if (options?.modal) setConfirmation(null)
      try { (refresh ?? router.refresh)() } catch {
        setNotice(previous => previous ? { ...previous, kind: 'info', text: `${previous.text} ${t('refreshFailed')}` } : previous)
      }
    }
    locked.current = false
    setPending(false)
  }

  /**
   * Invite gets its own handler (not the generic `run`) because success still
   * needs a decision: real delivery vs. "copy this link yourself" fallback when
   * Resend isn't configured or the send failed.
   */
  function onInvite(e: React.FormEvent) {
    e.preventDefault()
    const email = inviteEmail.trim()
    if (!email || !canManage || !options.includes(inviteRole)) return
    void run(() => actions.inviteMember(orgId, email, inviteRole), '', { email })
  }

  function openConfirmation(value: Confirmation, trigger: HTMLButtonElement) {
    if (locked.current || needsReview) return
    modalTrigger.current = trigger
    setModalError(null)
    setConfirmation(value)
  }

  function confirmAction() {
    if (!confirmation || locked.current || needsReview) return
    const { kind, targetId } = confirmation
    const target = members.find(member => member.userId === targetId)
    const canAct = canManage && target && target.userId !== meId && target.role in ROLE_RANK && ROLE_RANK[target.role] < myRank
    if (kind === 'leave' && members.some(member => member.userId === meId)) void run(() => actions.leaveOrg(orgId), t('toast.left'), { modal: true })
    else if (kind === 'remove' && canAct) void run(() => actions.removeMember(orgId, targetId), t('toast.removed'), { modal: true })
    else if (kind === 'transfer' && myRole === 'owner' && canAct) void run(() => actions.transferOwnership(orgId, targetId), t('toast.ownershipTransferred'), { modal: true })
    else if (kind === 'revoke' && canManage && invites.some(invite => invite.id === targetId)) void run(() => actions.revokeInvitation(targetId), t('toast.inviteRevoked'), { modal: true })
    else setModalError(t('toast.actionFailed'))
  }

  async function copyInvite() {
    if (!notice?.link || copying.current) return
    copying.current = true
    const epoch = copyEpoch.current
    setCopyState('pending')
    try {
      await copy(notice.link)
      if (epoch === copyEpoch.current) setCopyState('copied')
    } catch {
      if (epoch === copyEpoch.current) setCopyState('failed')
    } finally { if (epoch === copyEpoch.current) copying.current = false }
  }

  return (
    <div className={s.root} data-setting="team">
      {notice && (
        <div
          role={notice.kind === 'err' ? 'alert' : 'status'}
          data-save-notice tabIndex={-1} className={s.notice} data-kind={notice.kind}
        >
          <span className={s.noticeText}>{notice.text}</span>
          {notice.link && (
            <div className={s.copyRow}>
              <code>
                {notice.link}
              </code>
              <button
                type="button"
                className="dx-btn-ghost"
                disabled={copyState === 'pending'} aria-live="polite"
                onClick={copyInvite}
              >
                {copyState === 'idle' ? t('invite.copy') : copyState === 'pending' ? common('processing') : t(copyState === 'copied' ? 'copied' : 'copyFailed')}
              </button>
            </div>
          )}
        </div>
      )}
      {needsReview && <p className={s.reviewNote}>{t('reviewRequired')} <a href={reloadHref}>{t('reload')}</a></p>}

      {/* the team at a glance */}
      <dl className={s.summary}>
        <div className={s.figure}>
          <dt>{t('membersLabel')}</dt>
          <dd className={s.figureValue}>{members.length}</dd>
        </div>
        <div className={s.figure}>
          <dt>{t('myRoleLabel')}</dt>
          <dd className={s.figureValue}>{roleLabel(myRole)}</dd>
        </div>
        {canManage && !selfHosted && (
          <div className={s.figure}>
            <dt>{t('invites.sectionLabel')}</dt>
            <dd className={s.figureValue}>{invites.length}</dd>
          </div>
        )}
      </dl>

      {canManage && selfHosted && (
        <InternalAccounts
          orgId={orgId}
          roles={options}
          roleLabel={roleLabel}
          resettable={members.filter((m) => m.userId !== meId && m.role in ROLE_RANK && (ROLE_RANK[m.role] ?? 0) < myRank)}
        />
      )}

      {/* invite form (owner/admin) */}
      {canManage && !selfHosted && (
        <section className={s.invite} aria-labelledby={`${id}-invite`}>
          <div className={s.inviteHead}>
            <h2 id={`${id}-invite`} className={s.cardTitle}>{t('invite.cardTitle')}</h2>
            <p className={s.inviteHint}>{t('invite.hint')}</p>
          </div>
          <form onSubmit={onInvite} className={s.inviteForm}>
            <label className={s.fieldLabel} htmlFor={`${id}-email`}>{t('invite.emailPlaceholder')}</label>
            <div className={s.inviteControls}>
              <input
                id={`${id}-email`} disabled={pending || needsReview}
                className={s.input}
                type="email"
                required
                placeholder={t('invite.emailPlaceholder')}
                aria-label={t('invite.emailPlaceholder')}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <Select
                disabled={pending || needsReview}
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as AssignableRole)}
                ariaLabel={t('table.colRole')}
                rootClassName={s.roleSelect}
                className={s.selectTrigger}
                options={options.map((r) => ({ value: r, label: roleLabel(r) }))}
              />
              <button className={`dx-btn ${s.submit}`} type="submit" disabled={pending || needsReview}>
                {pending ? common('processing') : t('invite.send')}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* members table */}
      <section className={s.section} aria-labelledby={`${id}-members`}>
        <div className={s.sectionHead}>
          <h2 ref={heading} tabIndex={-1} id={`${id}-members`} className={s.sectionTitle}>{t('table.cardTitle')}</h2>
          <span className={s.count}>{t('table.count', { count: members.length })}</span>
        </div>
        <div className={s.tableCard}>
          {members.length === 0 && <p className={s.empty}>{t('emptyMembers')}</p>}
          {members.length > 0 && <p className={s.tableHint}>{t('tableScrollHint')}</p>}
          <div className={s.tableScroll} role="region" aria-label={t('table.cardTitle')} tabIndex={0}>
            <table className={`dx-table ${s.table}`}>
              <thead>
                <tr>
                  <th>{t('table.colMember')}</th>
                  <th>{t('table.colRole')}</th>
                  <th>{t('table.colJoined')}</th>
                  <th className={s.thActions} aria-label={t('table.colActions')} />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const isMe = m.userId === meId
                  const targetRank = ROLE_RANK[m.role] ?? 0
                  // a caller can act on a member strictly below their own rank
                  const canActOnTarget = canManage && !isMe && m.role in ROLE_RANK && targetRank < myRank
                  return (
                    <tr key={m.userId}>
                      <td>
                        <div className={s.member}>
                          <span className="dx-avatar">{initialsOf(m.displayName, m.email)}</span>
                          <span className={s.memberText}>
                            <strong className={s.memberName}>
                              {m.displayName ?? m.email ?? t('table.noName')}
                              {isMe && <span className={s.meSuffix}>{t('table.meSuffix')}</span>}
                            </strong>
                            <span className={s.memberEmail}>{m.email}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        {canActOnTarget ? (
                          <Select
                            size="sm"
                            value={m.role}
                            disabled={pending || needsReview}
                            ariaLabel={`${t('table.colRole')}: ${m.displayName ?? m.email ?? t('table.noName')}`}
                            onValueChange={v => { if (v !== m.role && options.includes(v as AssignableRole)) void run(() => actions.updateMemberRole(orgId, m.userId, v as AssignableRole), t('toast.roleChanged')) }}
                            // current role always selectable; plus any role the caller may assign
                            options={Array.from(new Set([m.role, ...options])).map((r) => ({
                              value: r,
                              label: roleLabel(r),
                            }))}
                          />
                        ) : (
                          <span className={`dx-badge ${m.role === 'owner' ? 'dx-badge-clay' : ''}`}>
                            {roleLabel(m.role)}
                          </span>
                        )}
                      </td>
                      <td className={s.date}>{dateLabel(m.joinedAt)}</td>
                      <td className={s.actionCell}>
                        {isMe ? selfHosted ? null : (
                          <button
                            className={s.rowAction}
                            type="button"
                            disabled={pending || needsReview}
                            onClick={event => openConfirmation({ kind: 'leave', targetId: meId, name: m.displayName ?? m.email ?? '' }, event.currentTarget)}
                          >
                            {t('actions.leave')}
                          </button>
                        ) : (
                          <>
                            {myRole === 'owner' && targetRank < myRank && (
                              <button
                                className={s.rowAction}
                                type="button"
                                disabled={pending || needsReview}
                                onClick={event => openConfirmation({ kind: 'transfer', targetId: m.userId, name: m.displayName ?? m.email ?? '' }, event.currentTarget)}
                              >
                                {t('actions.transferOwnership')}
                              </button>
                            )}
                            {canActOnTarget && (
                              <button
                                className={s.rowAction}
                                data-tone="negative"
                                type="button"
                                disabled={pending || needsReview}
                                onClick={event => openConfirmation({ kind: 'remove', targetId: m.userId, name: m.displayName ?? m.email ?? '' }, event.currentTarget)}
                              >
                                {t('actions.remove')}
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* pending invites (owner/admin) */}
      {canManage && !selfHosted && invites.length > 0 && (
        <section className={s.section} aria-labelledby={`${id}-invites`}>
          <div className={s.sectionHead}>
            <h2 id={`${id}-invites`} className={s.sectionTitle}>{t('invites.sectionLabel')}</h2>
            <span className={s.count}>{invites.length}</span>
          </div>
          <ul className={s.inviteList}>
            {invites.map((inv) => (
              <li key={inv.id} className={s.inviteRow}>
                <span className={s.inviteMain}>
                  <span className={s.inviteEmail}>{inv.email}</span>
                  <span className="dx-badge">{roleLabel(inv.role)}</span>
                </span>
                <span className={s.inviteExpiry}>
                  {t('invites.expires', { date: dateLabel(inv.expiresAt) })}
                </span>
                <span className={s.inviteActions}>
                  <button
                    className={s.rowAction}
                    type="button"
                    disabled={pending || needsReview}
                    onClick={event => openConfirmation({ kind: 'revoke', targetId: inv.id, name: inv.email }, event.currentTarget)}
                  >
                    {t('actions.cancel')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <BaseModal open={confirmation !== null} onClose={() => { if (!locked.current) setConfirmation(null) }}
        title={confirmation ? t(confirmation.kind === 'transfer' ? 'actions.transferOwnership' : confirmation.kind === 'remove' ? 'actions.remove' : confirmation.kind === 'leave' ? 'actions.leave' : 'cancelInviteTitle') : ''}
        description={confirmation ? confirmation.kind === 'transfer' || confirmation.kind === 'remove'
          ? t(`confirm.${confirmation.kind}`, { name: confirmation.name })
          : confirmation.kind === 'leave' ? t('confirmLeave') : t('confirmCancelInvite', { email: confirmation.name }) : undefined}
        size="sm" showCloseButton={false} closeDisabled={pending}
        onCloseAutoFocus={event => {
          event.preventDefault()
          const trigger = modalTrigger.current
          if (trigger?.isConnected && !trigger.disabled) trigger.focus({ preventScroll: true })
          else heading.current?.focus({ preventScroll: true })
        }}
        footer={<div className={s.modalActions}>
          <ModalButton variant="ghost" disabled={pending} onClick={() => setConfirmation(null)}>{common('close')}</ModalButton>
          <ModalButton variant="destructive" disabled={pending || needsReview} onClick={confirmAction}>{pending ? common('processing') : common('confirm')}</ModalButton>
        </div>}>
        {modalError && <p className={s.modalError} role="alert">{modalError}</p>}
      </BaseModal>
    </div>
  )
}
