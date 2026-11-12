import { appOrigin, isCloud } from '@/config/edition'
import 'server-only'

import * as Sentry from '@sentry/nextjs'

import { getServerTranslator } from '../i18n/server-translator'
import { getResendClient, emailFrom, emailReplyTo, emailLang } from './resend'
import { escapeHtml } from './escape'

type Translator = Awaited<ReturnType<typeof getServerTranslator>>

function appUrl(): string {
  return appOrigin()
}

/** CAN-SPAM postal-address slot (rendered when configured). */
function postalAddress(): string | null {
  return process.env.EMAIL_POSTAL_ADDRESS || null
}

/** The sample-data pitch only holds where a demo source is provisioned, and the contact line
 *  names the hosted service unless the operator set their own support address. */
function welcomeCopy(t: Translator): { body: string; cta: string; footer: string } {
  const hasSample = Boolean(process.env.DEMO_DATABASE_URL)
  const support = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim()
  return {
    body: t(hasSample ? 'body' : 'bodyNoSample'),
    cta: t(hasSample ? 'ctaButton' : 'ctaNoSample'),
    footer: support ? t('footerContact', { email: support }) : isCloud() ? t('footer') : '',
  }
}

function html(name: string, link: string, t: Translator, lang: string): string {
  const postal = postalAddress()
  const copy = welcomeCopy(t)
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
          <h1 style="font-size:20px;margin:0 0 16px;color:#1f1b16;">${t('heading', { name: escapeHtml(name) })}</h1>
          <p style="font-size:14px;line-height:1.6;color:#4a453d;margin:0 0 28px;">
            ${copy.body}
          </p>
          <a href="${link}" style="display:inline-block;background:#c96f4a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">${copy.cta}</a>
          ${copy.footer ? `<p style="font-size:12px;color:#9a9284;margin:28px 0 0;">${escapeHtml(copy.footer)}</p>` : ''}
          ${postal ? `<p style="font-size:11px;color:#b5ad9f;margin:16px 0 0;">${escapeHtml(postal)}</p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/**
 * Welcome email, sent once when a brand-new user's first workspace is created.
 * Never throws (best-effort) — a delivery failure must not affect org creation.
 */
export async function sendWelcomeEmail(args: { to: string; name: string; locale?: string }): Promise<{ sent: boolean }> {
  const client = getResendClient()
  const from = emailFrom()
  if (!client || !from) return { sent: false }
  try {
    const t = await getServerTranslator(args.locale, 'emailWelcome')
    const link = `${appUrl()}/app/ask`
    const postal = postalAddress()
    const copy = welcomeCopy(t)
    const { error } = await client.emails.send({
      from,
      to: args.to,
      replyTo: emailReplyTo(),
      subject: t('subject'),
      html: html(args.name, link, t, emailLang(args.locale)),
      // plain-text alternative — multipart is a strong deliverability signal
      text: [t('heading', { name: args.name }), '', copy.body, '', `${copy.cta}: ${link}`, ...(copy.footer ? ['', copy.footer] : []), ...(postal ? ['', postal] : [])].join('\n'),
    })
    if (error) {
      console.error('[email] welcome send failed:', error)
      Sentry.captureException(error, { tags: { to: args.to } })
      return { sent: false }
    }
    return { sent: true }
  } catch (e) {
    Sentry.captureException(e)
    return { sent: false }
  }
}
