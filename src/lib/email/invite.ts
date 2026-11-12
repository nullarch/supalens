import { appOrigin } from '@/config/edition'
import 'server-only'

import * as Sentry from '@sentry/nextjs'

import { getServerTranslator } from '../i18n/server-translator'
import { getResendClient, emailFrom, emailReplyTo, emailLang } from './resend'
import { escapeHtml } from './escape'

type Translator = Awaited<ReturnType<typeof getServerTranslator>>

const ROLE_KEY: Record<string, string> = {
  admin: 'roleAdmin',
  member: 'roleMember',
  viewer: 'roleViewer',
}

function appUrl(): string {
  return appOrigin()
}

function acceptUrl(token: string): string {
  return `${appUrl()}/app/invite/${token}`
}

function html(
  args: { orgName: string; inviterName: string; roleLabel: string; link: string; lang: string },
  t: Translator,
): string {
  // org/inviter names are user-authored — escape before embedding (spoofing vector)
  const orgName = escapeHtml(args.orgName)
  const inviterName = escapeHtml(args.inviterName)
  const { roleLabel, link, lang } = args
  return `<!doctype html>
<html lang="${lang}">
<body style="margin:0;padding:0;background:#f6f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" style="padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" style="background:#fff;border-radius:14px;padding:36px;border:1px solid #e8e2d8;">
        <tr><td>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>
            <td style="vertical-align:bottom;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-bottom:2px solid #211e1a;"><tr>
                <td style="vertical-align:bottom;padding:0 3px 0 0;"><div style="width:6px;height:10px;background:#211e1a;font-size:0;line-height:0;">&nbsp;</div></td>
                <td style="vertical-align:bottom;padding:0 3px 0 0;"><div style="width:6px;height:15px;background:#211e1a;font-size:0;line-height:0;">&nbsp;</div></td>
                <td style="vertical-align:bottom;"><div style="width:6px;height:21px;background:#a8553a;font-size:0;line-height:0;">&nbsp;</div></td>
              </tr></table>
            </td>
            <td style="vertical-align:bottom;padding-left:10px;">
              <span style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9a9284;">Supalens</span>
            </td>
          </tr></table>
          <h1 style="font-size:20px;margin:0 0 16px;color:#1f1b16;">${t('invitedYou', { inviter: inviterName, org: `<strong>${orgName}</strong>` })}</h1>
          <p style="font-size:14px;line-height:1.6;color:#4a453d;margin:0 0 28px;">
            ${t('body', { role: `<strong>${roleLabel}</strong>` })}
          </p>
          <a href="${link}" style="display:inline-block;background:#c96f4a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">${t('acceptButton')}</a>
          <p style="font-size:12px;color:#9a9284;margin:28px 0 0;word-break:break-all;">${t('linkFallback', { link })}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export interface InviteEmailResult {
  sent: boolean
  /** Always returned so the caller can offer a "copy link" fallback (sent or not). */
  link: string
  /** Present when sending failed or was skipped (no RESEND_API_KEY configured). */
  reason?: 'unconfigured' | 'error'
}

/**
 * Send an org-invitation email via Resend. Never throws: `invite_member` already
 * persisted the invitation row, so a delivery failure must not roll that back or
 * fail the action — it degrades to a "share this link" fallback in the UI.
 */
export async function sendInviteEmail(args: {
  to: string
  orgName: string
  inviterName: string
  role: string
  token: string
  locale?: string
}): Promise<InviteEmailResult> {
  const link = acceptUrl(args.token)
  const client = getResendClient()
  const from = emailFrom()
  if (!client || !from) {
    const what = !client ? 'RESEND_API_KEY not set' : 'RESEND_FROM_EMAIL not set (refusing resend.dev fallback in production)'
    console.warn(`[email] ${what} — invite link for ${args.to}: ${link}`)
    // in prod (not local dev) this means onboarding invites are silently not
    // being delivered — worth a signal, even though the UI has a copy-link fallback.
    Sentry.captureMessage(`invite email skipped: ${what}`, { level: 'warning' })
    return { sent: false, link, reason: 'unconfigured' }
  }

  const t = await getServerTranslator(args.locale, 'emailInvite')
  const roleLabel = ROLE_KEY[args.role] ? t(ROLE_KEY[args.role]) : args.role
  const subject = t('invitedYou', { inviter: args.inviterName, org: args.orgName })
  const { error } = await client.emails.send({
    from,
    to: args.to,
    replyTo: emailReplyTo(),
    subject,
    html: html(
      { orgName: args.orgName, inviterName: args.inviterName, roleLabel, link, lang: emailLang(args.locale) },
      t,
    ),
    // plain-text alternative — multipart is a strong deliverability signal
    text: [subject, '', t('body', { role: roleLabel }), '', `${t('acceptButton')}: ${link}`].join('\n'),
  })

  if (error) {
    console.error('[email] invite send failed:', error)
    Sentry.captureException(error, { tags: { to: args.to } })
    return { sent: false, link, reason: 'error' }
  }
  return { sent: true, link }
}
