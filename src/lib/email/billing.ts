// NOTE: intentionally NOT `import 'server-only'` — callable from webhook routes AND
// Trigger-shared metering code, same convention as email/alert.ts. Never throws.
import { appOrigin } from '@/config/edition'
import * as Sentry from '@sentry/node'

import { getServerTranslator } from '../i18n/server-translator'
import { getResendClient, emailFrom, emailReplyTo, emailLang } from './resend'
import { escapeHtml } from './escape'

function appUrl(): string {
  return appOrigin()
}

function shell(inner: string, lang: string): string {
  return `<!doctype html>
<html lang="${lang}">
<body style="margin:0;padding:0;background:#f6f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" style="padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" style="background:#fff;border-radius:14px;padding:36px;border:1px solid #e8e2d8;">
        <tr><td>
          <span style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#9a9284;">Supalens</span>
          ${inner}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export interface BillingEmailResult {
  sent: boolean
  reason?: 'unconfigured' | 'error' | 'no_recipients'
}

async function send(
  to: string[],
  subject: string,
  inner: string,
  textBody: string,
  tag: string,
  lang: string,
): Promise<BillingEmailResult> {
  const recipients = to.filter(Boolean)
  if (recipients.length === 0) return { sent: false, reason: 'no_recipients' }
  const client = getResendClient()
  const from = emailFrom()
  if (!client || !from) {
    const what = !client ? 'RESEND_API_KEY not set' : 'RESEND_FROM_EMAIL not set (refusing resend.dev fallback in production)'
    console.warn(`[email] ${what} — ${tag} would notify: ${recipients.join(', ')}`)
    return { sent: false, reason: 'unconfigured' }
  }
  const { error } = await client.emails.send({
    from,
    to: recipients,
    replyTo: emailReplyTo(),
    subject,
    html: shell(inner, lang),
    // plain-text alternative — multipart is a strong deliverability signal
    text: textBody,
  })
  if (error) {
    console.error(`[email] ${tag} send failed:`, error)
    Sentry.captureException(error, { tags: { email: tag } })
    return { sent: false, reason: 'error' }
  }
  return { sent: true }
}

/** Payment failed / subscription past-due — dunning notice with a billing-portal CTA. */
export async function sendPaymentFailedEmail(args: {
  to: string[]
  orgName: string
  plan: string
  locale?: string
}): Promise<BillingEmailResult> {
  const t = await getServerTranslator(args.locale, 'emailBilling')
  const link = `${appUrl()}/app/settings/billing`
  const subject = t('paymentFailedSubject', { org: args.orgName })
  return send(
    args.to,
    subject,
    `
      <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#c0392b;margin:20px 0 8px;font-weight:600;">${t('paymentFailedLabel')}</p>
      <h1 style="font-size:20px;margin:0 0 6px;color:#1f1b16;">${escapeHtml(args.orgName)}</h1>
      <p style="font-size:14px;line-height:1.7;color:#4a453d;margin:0 0 20px;">
        ${t('paymentFailedBody', { plan: escapeHtml(args.plan) })}
      </p>
      <a href="${link}" style="display:inline-block;background:#c96f4a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">${t('paymentFailedButton')}</a>`,
    [subject, '', t('paymentFailedBody', { plan: args.plan }), '', `${t('paymentFailedButton')}: ${link}`].join('\n'),
    'payment-failed',
    emailLang(args.locale),
  )
}

/** Quota nearly used (≥80% of the monthly query budget) — sent once per period. */
export async function sendQuotaWarningEmail(args: {
  to: string[]
  orgName: string
  plan: string
  used: number
  limit: number
  locale?: string
}): Promise<BillingEmailResult> {
  const t = await getServerTranslator(args.locale, 'emailBilling')
  const pct = Math.min(100, Math.round((args.used / Math.max(1, args.limit)) * 100))
  const link = `${appUrl()}/app/settings/billing`
  const subject = t('quotaSubject', { pct, org: args.orgName })
  const meter = `${args.used.toLocaleString('ko-KR')} / ${args.limit.toLocaleString('ko-KR')} (${pct}%)`
  return send(
    args.to,
    subject,
    `
      <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#b06a3a;margin:20px 0 8px;font-weight:600;">${t('quotaLabel')}</p>
      <h1 style="font-size:20px;margin:0 0 6px;color:#1f1b16;">${escapeHtml(args.orgName)}</h1>
      <div style="background:#faf8f4;border:1px solid #eee7db;border-radius:10px;padding:16px;margin:16px 0 20px;">
        <p style="font-size:13px;color:#6b6459;margin:0 0 6px;">${t('quotaMeterLabel')}</p>
        <p style="font-size:18px;font-weight:700;color:#b06a3a;margin:0;font-variant-numeric:tabular-nums;">
          ${meter}
        </p>
      </div>
      <p style="font-size:14px;line-height:1.7;color:#4a453d;margin:0 0 20px;">
        ${t('quotaBody')}
      </p>
      <a href="${link}" style="display:inline-block;background:#c96f4a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">${t('quotaButton')}</a>`,
    [subject, '', `${t('quotaMeterLabel')}: ${meter}`, '', t('quotaBody'), '', `${t('quotaButton')}: ${link}`].join('\n'),
    'quota-warning',
    emailLang(args.locale),
  )
}

/**
 * Monthly query limit REACHED (100%) — the upgrade email (X2). Sent once per
 * period, distinct from the 80% warning. Framed as an operational state change
 * ("you've used your last query, resets on {date}") with an upgrade CTA — kept
 * factual so it stays 정보성/relationship, not a marketing blast.
 */
export async function sendQuotaReachedEmail(args: {
  to: string[]
  orgName: string
  plan: string
  limit: number
  /** current_period_ends_at ISO — when the quota resets (shown to soften the block). */
  resetsAt?: string | null
  locale?: string
}): Promise<BillingEmailResult> {
  const t = await getServerTranslator(args.locale, 'emailBilling')
  const link = `${appUrl()}/app/settings/billing`
  const subject = t('quotaReachedSubject', { org: args.orgName })
  const meter = `${args.limit.toLocaleString('ko-KR')} / ${args.limit.toLocaleString('ko-KR')} (100%)`
  // reset date is a SEPARATE optional sentence (plan is a safe enum, no escaping needed).
  const resets = args.resetsAt
    ? new Intl.DateTimeFormat(args.locale === 'ja' ? 'ja-JP' : args.locale === 'en' ? 'en-US' : 'ko-KR', {
        dateStyle: 'medium',
      }).format(new Date(args.resetsAt))
    : ''
  const body = t('quotaReachedBody', { plan: args.plan }) + (resets ? ' ' + t('quotaReachedResets', { date: resets }) : '')
  return send(
    args.to,
    subject,
    `
      <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#c0392b;margin:20px 0 8px;font-weight:600;">${t('quotaReachedLabel')}</p>
      <h1 style="font-size:20px;margin:0 0 6px;color:#1f1b16;">${escapeHtml(args.orgName)}</h1>
      <div style="background:#faf8f4;border:1px solid #eee7db;border-radius:10px;padding:16px;margin:16px 0 20px;">
        <p style="font-size:13px;color:#6b6459;margin:0 0 6px;">${t('quotaMeterLabel')}</p>
        <p style="font-size:18px;font-weight:700;color:#c0392b;margin:0;font-variant-numeric:tabular-nums;">${meter}</p>
      </div>
      <p style="font-size:14px;line-height:1.7;color:#4a453d;margin:0 0 20px;">${body}</p>
      <a href="${link}" style="display:inline-block;background:#c96f4a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">${t('quotaReachedButton')}</a>`,
    [subject, '', `${t('quotaMeterLabel')}: ${meter}`, '', body, '', `${t('quotaReachedButton')}: ${link}`].join('\n'),
    'quota-reached',
    emailLang(args.locale),
  )
}
