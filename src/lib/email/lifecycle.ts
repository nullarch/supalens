// NOT `import 'server-only'` — called from the Trigger.dev lifecycle-emails sweep
// (plain Node bundle). Uses @sentry/node, same convention as email/digest.ts.
import { appOrigin } from '@/config/edition'
import * as Sentry from '@sentry/node'

import { getServerTranslator } from '../i18n/server-translator'
import { getResendClient, emailFrom, emailReplyTo, emailLang } from './resend'
import { escapeHtml } from './escape'
import { unsubscribeUrl } from './unsubscribe'

type Translator = Awaited<ReturnType<typeof getServerTranslator>>

/**
 * The activation nudges. Each maps to a nested key group in the `emailLifecycle`
 * message namespace ({subject, heading, body, cta}) and a destination screen.
 * INSTRUCTIONAL only (정보성) — "finish what you started", never a sales pitch —
 * which is what keeps them legal under an opt-out model (see the migration note).
 */
export type LifecycleNudge = 'connectSource' | 'connectRepo' | 'approveKpis' | 'connectSlack'

// Every nudge lands on the resumable setup flow except the last, which needs the
// channel picker itself.
const NUDGE_PATH: Record<LifecycleNudge, string> = {
  connectSource: '/app/setup',
  connectRepo: '/app/setup',
  approveKpis: '/app/setup',
  connectSlack: '/app/settings/notifications',
}

function appUrl(): string {
  return appOrigin()
}

/** CAN-SPAM postal-address slot for recurring mail (rendered when configured). */
function postalAddress(): string | null {
  return process.env.EMAIL_POSTAL_ADDRESS || null
}

interface Rendered {
  heading: string
  body: string
  cta: string
  link: string
}

function html(r: Rendered, t: Translator, lang: string, unsubUrl: string | null): string {
  const postal = postalAddress()
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
          <h1 style="font-size:20px;margin:0 0 16px;color:#1f1b16;">${escapeHtml(r.heading)}</h1>
          <p style="font-size:14px;line-height:1.7;color:#4a453d;margin:0 0 28px;white-space:pre-line;">${escapeHtml(r.body)}</p>
          <a href="${r.link}" style="display:inline-block;background:#c96f4a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">${escapeHtml(r.cta)}</a>
          <p style="font-size:12px;color:#9a9284;margin:28px 0 0;">${t('footer')}</p>
          ${
            unsubUrl
              ? `<p style="font-size:12px;color:#9a9284;margin:8px 0 0;"><a href="${unsubUrl}" style="color:#9a9284;">${t('unsubscribe')}</a></p>`
              : ''
          }
          ${postal ? `<p style="font-size:11px;color:#b5ad9f;margin:16px 0 0;">${escapeHtml(postal)}</p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function text(r: Rendered, t: Translator, unsubUrl: string | null): string {
  const postal = postalAddress()
  const lines = [r.heading, '', r.body, '', `${r.cta}: ${r.link}`, '', t('footer')]
  if (unsubUrl) lines.push(`${t('unsubscribe')}: ${unsubUrl}`)
  if (postal) lines.push('', postal)
  return lines.join('\n')
}

export interface LifecycleRecipient {
  email: string
  /** profiles.id — signs the per-recipient one-click unsubscribe token */
  userId: string
}

/**
 * Send one activation nudge to one recipient (the org owner). Never throws
 * (best-effort, mirrors sendDigestEmail). Carries the one-click List-Unsubscribe
 * headers (kind: 'lifecycle') — the Gmail/Yahoo bulk-sender requirement.
 */
export async function sendLifecycleEmail(args: {
  to: LifecycleRecipient
  orgId: string
  nudge: LifecycleNudge
  /** data_sources.name for the {source} placeholder (source-stage nudges); optional otherwise. */
  sourceName?: string
  locale?: string
}): Promise<{ sent: boolean; reason?: 'unconfigured' | 'error' | 'no_recipients' }> {
  if (!args.to.email) return { sent: false, reason: 'no_recipients' }
  const client = getResendClient()
  const from = emailFrom()
  if (!client || !from) return { sent: false, reason: 'unconfigured' }

  const t = await getServerTranslator(args.locale, 'emailLifecycle')
  const lang = emailLang(args.locale)
  const vars = { source: args.sourceName ?? '' }
  const rendered: Rendered = {
    heading: t(`${args.nudge}.heading`, vars),
    body: t(`${args.nudge}.body`, vars),
    cta: t(`${args.nudge}.cta`, vars),
    link: `${appUrl()}${NUDGE_PATH[args.nudge]}`,
  }
  const subject = t(`${args.nudge}.subject`, vars)
  const unsubUrl = unsubscribeUrl({ userId: args.to.userId, orgId: args.orgId, kind: 'lifecycle' })

  const { error } = await client.emails.send({
    from,
    to: args.to.email,
    replyTo: emailReplyTo(),
    subject,
    html: html(rendered, t, lang, unsubUrl),
    text: text(rendered, t, unsubUrl),
    ...(unsubUrl
      ? {
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }
      : {}),
  })
  if (error) {
    console.error('[email] lifecycle send failed:', error)
    Sentry.captureException(error, { tags: { nudge: args.nudge } })
    return { sent: false, reason: 'error' }
  }
  return { sent: true }
}
