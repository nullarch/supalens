// NOTE: intentionally NOT `import 'server-only'` — this module is called from
// the Trigger.dev evaluate-alerts task (a plain Node bundle where the
// server-only guard throws), same convention as utils/supabase/admin.ts. Uses
// @sentry/node (not @sentry/nextjs) for the same reason — this file runs in
// whichever process called it (Next.js or Trigger.dev); @sentry/node's
// captureException reports through whichever SDK's Sentry.init ran in that
// process (src/instrumentation.ts or trigger/sentry.ts), since both share the
// same @sentry/core client underneath.
import { appOrigin } from '@/config/edition'
import * as Sentry from '@sentry/node'
import { OPERATOR_SYMBOL, expectedRangeLabel, type AlertOp } from '@/lib/alerts/evaluate'

import { getServerTranslator } from '../i18n/server-translator'
import { getResendClient, emailFrom, emailReplyTo, emailLang } from './resend'
import { escapeHtml } from './escape'
import { unsubscribeUrl } from './unsubscribe'

type Translator = Awaited<ReturnType<typeof getServerTranslator>>

function appUrl(): string {
  return appOrigin()
}


function fmt(n: number): string {
  return new Intl.NumberFormat('ko-KR').format(n)
}

/**
 * The condition line. `operator` is the FIRING condition, so on a fired edge
 * "value < threshold" is a true statement; on a resolved edge it no longer holds, and the
 * honest reading is the range the metric is expected to stay inside (inverted operator —
 * same helper as /app/overview and the monitor screens).
 */
function conditionLine(a: { kind: 'fired' | 'resolved'; value: number; operator: string; threshold: number }): string {
  const sym = OPERATOR_SYMBOL[a.operator as AlertOp] ?? a.operator
  if (a.kind === 'fired') return `${fmt(a.value)} ${sym} ${fmt(a.threshold)}`
  return `${fmt(a.value)} · ${expectedRangeLabel(a.operator as AlertOp, fmt(a.threshold))}`
}

interface AlertMailContent {
  kind: 'fired' | 'resolved'
  alertName: string
  orgName: string
  value: number
  operator: string
  threshold: number
  /** Anomaly alerts are threshold-LESS (operator/threshold are unused placeholders 'gt'/0), so the
   *  `value > 0` condition box is meaningless and must be suppressed — the `message` carries the
   *  deviation (value, mean, z) instead. */
  isAnomaly?: boolean
  /** goal monitors: the operator's words, shown under the monitor name */
  goal?: string | null
  message?: string | null
  explanation?: string | null
  link: string
}

function html(a: AlertMailContent, t: Translator, lang: string, unsubUrl: string | null): string {
  const firing = a.kind === 'fired'
  const accent = firing ? '#c0392b' : '#2e7d54'
  const heading = t(firing ? 'headingFired' : 'headingResolved')
  const cond = conditionLine(a)
  // Anomaly alerts have no user threshold → the condition box would read a misleading "value > 0";
  // the current value is shown in its own tile instead.
  const conditionBlock = a.isAnomaly
    ? `<div style="background:#faf8f4;border:1px solid #eee7db;border-radius:10px;padding:16px;margin:0 0 20px;">
            <p style="font-size:13px;color:#6b6459;margin:0 0 6px;">${t('currentValueLabel')}</p>
            <p style="font-size:18px;font-weight:700;color:${accent};margin:0;font-variant-numeric:tabular-nums;">${fmt(a.value)}</p>
          </div>`
    : `<div style="background:#faf8f4;border:1px solid #eee7db;border-radius:10px;padding:16px;margin:0 0 20px;">
            <p style="font-size:13px;color:#6b6459;margin:0 0 6px;">${t('conditionLabel')}</p>
            <p style="font-size:18px;font-weight:700;color:${accent};margin:0;font-variant-numeric:tabular-nums;">${cond}</p>
          </div>`
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
          <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${accent};margin:0 0 8px;font-weight:600;">${heading}</p>
          <h1 style="font-size:20px;margin:0 0 6px;color:#1f1b16;">${escapeHtml(a.alertName)}</h1>
          <p style="font-size:13px;color:#9a9284;margin:0 0 ${a.goal ? '8px' : '20px'};">${escapeHtml(a.orgName)}</p>
          ${a.goal ? `<p style="font-size:14px;color:#4a453d;margin:0 0 20px;"><span style="color:#9a9284;">${t('goalLabel')}</span> · ${escapeHtml(a.goal)}</p>` : ''}
          ${conditionBlock}
          ${a.message ? `<p style="font-size:14px;line-height:1.6;color:#4a453d;margin:0 0 20px;">${escapeHtml(a.message)}</p>` : ''}
          ${
            a.explanation
              ? `<div style="background:#fdf6ee;border:1px solid #f0e2cf;border-radius:10px;padding:16px;margin:0 0 24px;">
            <p style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#b06a3a;margin:0 0 8px;font-weight:600;">${t('likelyCause')}</p>
            <p style="font-size:14px;line-height:1.7;color:#4a453d;margin:0;white-space:pre-line;">${escapeHtml(a.explanation)}</p>
          </div>`
              : ''
          }
          <a href="${a.link}" style="display:inline-block;background:#c96f4a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">${t('viewButton')}</a>
          ${
            unsubUrl
              ? `<p style="font-size:12px;color:#9a9284;margin:28px 0 0;"><a href="${unsubUrl}" style="color:#9a9284;">${t('unsubscribe')}</a></p>`
              : ''
          }
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Plain-text alternative (multipart text/plain is a strong deliverability signal). */
function text(a: AlertMailContent, t: Translator, unsubUrl: string | null): string {
  const heading = t(a.kind === 'fired' ? 'headingFired' : 'headingResolved')
  const cond = conditionLine(a)
  const lines = [
    `Supalens — ${heading}`,
    '',
    `${a.alertName} (${a.orgName})`,
    ...(a.goal ? [`${t('goalLabel')}: ${a.goal}`] : []),
    a.isAnomaly ? `${t('currentValueLabel')}: ${fmt(a.value)}` : `${t('conditionLabel')}: ${cond}`,
  ]
  if (a.message) lines.push('', a.message)
  if (a.explanation) lines.push('', `${t('likelyCause')}:`, a.explanation)
  lines.push('', `${t('viewButton')}: ${a.link}`)
  if (unsubUrl) lines.push('', `${t('unsubscribe')}: ${unsubUrl}`)
  return lines.join('\n')
}

export interface AlertEmailRecipient {
  email: string
  /** profiles.id — signs the per-recipient one-click unsubscribe token */
  userId: string
}

export interface AlertEmailResult {
  sent: boolean
  reason?: 'unconfigured' | 'error' | 'no_recipients'
}

/**
 * Send an alert fired/resolved notification. Same contract as the invite email:
 * NEVER throws — the alert row + event are already committed, so a delivery
 * failure must not fail the evaluation run. Recipients are resolved by the
 * runner (org owner/admin verified addresses — never free-text) to keep alerts
 * from being an exfil channel.
 *
 * Sent per-recipient (not one batched `to`) because the one-click unsubscribe
 * token in the List-Unsubscribe header is recipient-specific.
 */
export async function sendAlertEmail(args: {
  to: AlertEmailRecipient[]
  orgId: string
  kind: 'fired' | 'resolved'
  alertName: string
  orgName: string
  value: number
  operator: string
  threshold: number
  /** anomaly alerts are threshold-less → suppress the `value > 0` condition box (see AlertMailContent). */
  isAnomaly?: boolean
  /** goal monitors: the operator's words, shown under the monitor name */
  goal?: string | null
  message?: string | null
  explanation?: string | null
  locale?: string
  /** the monitor's id — the CTA's fallback target (/app/monitors/<id>, list when absent). */
  alertId?: string | null
  /** the FIRED alert_events id — when known the CTA deep-links to that incident instead. */
  eventId?: string | null
}): Promise<AlertEmailResult> {
  const to = args.to.filter((r) => Boolean(r.email))
  if (to.length === 0) return { sent: false, reason: 'no_recipients' }

  const t = await getServerTranslator(args.locale, 'emailAlert')
  const client = getResendClient()
  const from = emailFrom()
  // The incident page is the actionable destination (triage + the AI's account); the monitor is
  // the fallback for edges we don't have an event row for.
  const link = args.eventId
    ? `${appUrl()}/app/incidents/${args.eventId}`
    : args.alertId
      ? `${appUrl()}/app/monitors/${args.alertId}`
      : `${appUrl()}/app/monitors`
  if (!client || !from) {
    const what = !client ? 'RESEND_API_KEY not set' : 'RESEND_FROM_EMAIL not set (refusing resend.dev fallback in production)'
    console.warn(`[email] ${what} — alert "${args.alertName}" (${args.kind}) would notify: ${to.map((r) => r.email).join(', ')}`)
    // a firing alert that silently can't notify anyone is worth knowing about in
    // prod (misconfigured env), unlike local dev where this is expected.
    Sentry.captureMessage(`alert notification skipped: ${what}`, { level: 'warning' })
    return { sent: false, reason: 'unconfigured' }
  }

  const subject = t(args.kind === 'fired' ? 'subjectFired' : 'subjectResolved', { name: args.alertName })
  const lang = emailLang(args.locale)
  const content: AlertMailContent = { ...args, link }

  let anySent = false
  let lastError: unknown = null
  for (const r of to) {
    const unsubUrl = unsubscribeUrl({ userId: r.userId, orgId: args.orgId, kind: 'alert' })
    const { error } = await client.emails.send({
      from,
      to: r.email,
      replyTo: emailReplyTo(),
      subject,
      html: html(content, t, lang, unsubUrl),
      text: text(content, t, unsubUrl),
      ...(unsubUrl
        ? {
            headers: {
              'List-Unsubscribe': `<${unsubUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    })
    if (error) lastError = error
    else anySent = true
  }

  if (lastError) {
    console.error('[email] alert send failed:', lastError)
    Sentry.captureException(lastError, { tags: { alertName: args.alertName, kind: args.kind } })
  }
  if (!anySent) return { sent: false, reason: 'error' }
  return { sent: true }
}
