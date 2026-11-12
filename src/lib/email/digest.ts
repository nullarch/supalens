// NOT `import 'server-only'` — called from the Trigger.dev weekly-digest task (plain Node
// bundle). Uses @sentry/node, same convention as email/alert.ts.
import { appOrigin } from '@/config/edition'
import * as Sentry from '@sentry/node'

import { getServerTranslator } from '../i18n/server-translator'
import { getResendClient, emailFrom, emailReplyTo, emailLang } from './resend'
import { escapeHtml } from './escape'
import { unsubscribeUrl } from './unsubscribe'

type Translator = Awaited<ReturnType<typeof getServerTranslator>>

function appUrl(): string {
  return appOrigin()
}

/** CAN-SPAM postal-address slot for recurring mail (rendered when configured). */
function postalAddress(): string | null {
  return process.env.EMAIL_POSTAL_ADDRESS || null
}

/** A row in a deterministic (non-LLM) digest block. */
export interface DigestItem {
  label: string
  value?: string | null
  note?: string | null
}

/**
 * One block of the consolidated digest. Either an LLM prose `summary` (the per-source KPI
 * change narrative) or deterministic `items` (monitor health, incidents, review queue) —
 * the operator sections must never depend on the model having produced text.
 */
export interface DigestSection {
  name: string
  summary?: string
  items?: DigestItem[]
}

interface DigestMail {
  orgName: string
  sections: DigestSection[]
  /** active sources beyond the per-digest cap that were not summarized (footer note only). */
  moreCount: number
  link: string
}

function itemsHtml(items: DigestItem[]): string {
  return items
    .map(
      (i) => `<tr>
      <td style="font-size:14px;line-height:1.6;color:#3d382f;padding:5px 0;">${escapeHtml(i.label)}${
        i.note ? `<span style="color:#9a9284;font-size:12px;"> · ${escapeHtml(i.note)}</span>` : ''
      }</td>
      <td align="right" style="font-size:14px;line-height:1.6;color:#1f1b16;font-weight:600;padding:5px 0;white-space:nowrap;">${escapeHtml(i.value ?? '')}</td>
    </tr>`,
    )
    .join('')
}

function sectionHtml(sec: DigestSection): string {
  const body = sec.items?.length
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;">${itemsHtml(sec.items)}</table>`
    : `<p style="font-size:14px;line-height:1.75;color:#3d382f;margin:0;white-space:pre-line;">${escapeHtml(sec.summary ?? '')}</p>`
  return `<div style="margin:0 0 18px;">
    <p style="font-size:15px;font-weight:600;color:#1f1b16;margin:0 0 8px;">${escapeHtml(sec.name)}</p>
    <div style="background:#faf8f4;border:1px solid #eee7db;border-radius:10px;padding:16px;">
      ${body}
    </div>
  </div>`
}

function html(a: DigestMail, t: Translator, lang: string, unsubUrl: string | null): string {
  const postal = postalAddress()
  const more =
    a.moreCount > 0
      ? `<p style="font-size:12px;color:#9a9284;margin:0 0 20px;">${t('moreSources', { count: a.moreCount })}</p>`
      : ''
  return `<!doctype html>
<html lang="${lang}">
<body style="margin:0;padding:0;background:#f6f3ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" style="padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="520" style="background:#fff;border-radius:14px;padding:36px;border:1px solid #e8e2d8;">
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
          <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#b06a3a;margin:0 0 8px;font-weight:600;">${t('label')}</p>
          <h1 style="font-size:20px;margin:0 0 6px;color:#1f1b16;">${escapeHtml(a.orgName)}</h1>
          <p style="font-size:13px;color:#9a9284;margin:0 0 20px;">${t('subtitle', { org: escapeHtml(a.orgName) })}</p>
          ${a.sections.map(sectionHtml).join('')}
          ${more}
          <a href="${a.link}" style="display:inline-block;background:#c96f4a;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;">${t('ctaButton')}</a>
          <p style="font-size:12px;color:#9a9284;margin:24px 0 0;">${t('footer')}</p>
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

/** Plain-text alternative (multipart text/plain is a strong deliverability signal). */
function text(a: DigestMail, t: Translator, unsubUrl: string | null): string {
  const postal = postalAddress()
  const lines = [`Supalens — ${t('label')}`, '', `${a.orgName} · ${t('subtitle', { org: a.orgName })}`, '']
  for (const sec of a.sections) {
    lines.push(`## ${sec.name}`)
    if (sec.items?.length) {
      for (const i of sec.items) {
        lines.push(`- ${i.label}${i.note ? ` (${i.note})` : ''}${i.value ? `: ${i.value}` : ''}`)
      }
    } else if (sec.summary) {
      lines.push(sec.summary)
    }
    lines.push('')
  }
  if (a.moreCount > 0) lines.push(t('moreSources', { count: a.moreCount }), '')
  lines.push(`${t('ctaButton')}: ${a.link}`, '', t('footer'))
  if (unsubUrl) lines.push(`${t('unsubscribe')}: ${unsubUrl}`)
  if (postal) lines.push('', postal)
  return lines.join('\n')
}

export interface DigestRecipient {
  email: string
  /** profiles.id — signs the per-recipient one-click unsubscribe token */
  userId: string
}

/**
 * Send ONE consolidated weekly digest per org covering every summarized source as a
 * section (was one email PER data source — an inbox bomb for orgs with many sources).
 * Never throws (best-effort, mirrors sendAlertEmail). Still sent per-recipient because the
 * one-click List-Unsubscribe token is recipient-specific (Gmail/Yahoo bulk-sender rule).
 */
export async function sendDigestEmail(args: {
  to: DigestRecipient[]
  orgId: string
  orgName: string
  sections: DigestSection[]
  moreCount?: number
  locale?: string
}): Promise<{ sent: boolean; reason?: 'unconfigured' | 'error' | 'no_recipients' | 'no_sections' }> {
  const to = args.to.filter((r) => Boolean(r.email))
  if (to.length === 0) return { sent: false, reason: 'no_recipients' }
  if (args.sections.length === 0) return { sent: false, reason: 'no_sections' }
  const client = getResendClient()
  const from = emailFrom()
  if (!client || !from) return { sent: false, reason: 'unconfigured' }
  const t = await getServerTranslator(args.locale, 'emailDigest')
  const lang = emailLang(args.locale)
  const subject = t('subject', { org: args.orgName })
  const content: DigestMail = {
    orgName: args.orgName,
    sections: args.sections,
    moreCount: args.moreCount ?? 0,
    // The digest is an operator report: it lands on the monitoring home, not the chat box.
    link: `${appUrl()}/app/overview`,
  }

  let anySent = false
  let lastError: unknown = null
  for (const r of to) {
    const unsubUrl = unsubscribeUrl({ userId: r.userId, orgId: args.orgId, kind: 'digest' })
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
    console.error('[email] digest send failed:', lastError)
    Sentry.captureException(lastError, { tags: { orgId: args.orgId } })
  }
  if (!anySent) return { sent: false, reason: 'error' }
  return { sent: true }
}
