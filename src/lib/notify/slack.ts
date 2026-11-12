// NOT `import 'server-only'` — used by the Trigger.dev alert runner + explain task (plain Node
// bundle). Slack primitives + message formatting for alert notifications. Never throws:
// a delivery failure must not fail the evaluation run (same contract as email/alert.ts).
// Delivery ROUTING (bot channel vs legacy webhook, provider-neutral) lives in ./dispatch.ts.
import { appOrigin } from '@/config/edition'
import { requireAdminClient } from '@/utils/supabase/admin'

/** Provider-neutral alert notification payload (shared by every channel adapter). */
export interface AlertNotifyArgs {
  kind: 'fired' | 'resolved'
  alertName: string
  message: string
  explanation?: string | null
  /** org locale (resolved by the caller) — localizes the header/labels so Slack matches the email. */
  locale?: string
  /** the monitor's id — the fallback deep-link target (/app/monitors/<id>, list when absent). */
  alertId?: string | null
  /** the FIRED alert_events id — when known, the notification deep-links to the INCIDENT instead,
   *  which is where the triage (ack / expected / snooze / cause feedback) actually lives. */
  eventId?: string | null
}

function appUrl(): string {
  return appOrigin()
}

/** Where a notification's "view" affordance lands: the exact monitor when we know it, else the list. */
export function monitorLink(alertId?: string | null): string {
  return alertId ? `${appUrl()}/app/monitors/${alertId}` : `${appUrl()}/app/monitors`
}

/**
 * THE deep-link seam for alert notifications. An incident page exists only once the FIRED event row
 * is committed, so callers that know the event id (the runner and the explain task) land the reader
 * on the incident; everything else — resolved-edge posts, legacy callers — falls back to the monitor.
 */
export function alertDeepLink(args: Pick<AlertNotifyArgs, 'alertId' | 'eventId'>): string {
  return args.eventId ? `${appUrl()}/app/incidents/${args.eventId}` : monitorLink(args.alertId)
}

/** Render an alert into a Slack mrkdwn message (localized to the org locale — the body is already
 *  localized by the caller, so the header/labels must match). Reused by both the bot and webhook
 *  paths as the notification-text fallback under the Block Kit layout. Async because it resolves
 *  the server-side translator (static JSON, Trigger-bundlable). */
export async function formatAlertText(args: AlertNotifyArgs): Promise<string> {
  const { getServerTranslator } = await import('@/lib/i18n/server-translator')
  const t = await getServerTranslator(args.locale, 'emailAlert')
  const icon = args.kind === 'fired' ? '🔴' : '🟢'
  const head = t(args.kind === 'fired' ? 'headingFired' : 'headingResolved')
  const lines = [`${icon} *[${head}] ${args.alertName}*`, args.message]
  if (args.explanation) lines.push('', `${t('likelyCause')}: ${args.explanation}`)
  lines.push('', `${t('viewButton')}: ${alertDeepLink(args)}`)
  return lines.join('\n')
}

// Slack Block Kit hard limits (the API rejects the whole message on violation) — cap so a long
// alert name / message / AI explanation degrades to a truncated card, never a silent non-delivery.
const HEADER_MAX = 150
const SECTION_MAX = 3000
const cap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/**
 * Block Kit layout for an alert: header (status + name) → what changed (the localized body, which
 * already carries the current value / threshold or the anomaly deviation) → the AI explanation as
 * its OWN labelled section ("likely cause" — a hypothesis, visibly separate from the data facts
 * above it) → a view button deep-linked to the incident (falling back to the monitor). `text`
 * (formatAlertText) stays the
 * notification-tray fallback. Same shape for the bot (chat.postMessage) and incoming-webhook paths.
 */
export async function buildAlertBlocks(args: AlertNotifyArgs): Promise<unknown[]> {
  const { getServerTranslator } = await import('@/lib/i18n/server-translator')
  const t = await getServerTranslator(args.locale, 'emailAlert')
  const icon = args.kind === 'fired' ? '🔴' : '🟢'
  const head = t(args.kind === 'fired' ? 'headingFired' : 'headingResolved')
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: cap(`${icon} ${head} · ${args.alertName}`, HEADER_MAX), emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: cap(`*${t('confirmedInData')}*\n${args.message}`, SECTION_MAX) } },
  ]
  if (args.explanation) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: cap(`*${t('likelyCause')}*\n${args.explanation}`, SECTION_MAX) } })
  }
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: cap(t('viewButton'), 75), emoji: false },
        url: alertDeepLink(args),
        ...(args.kind === 'fired' ? { style: 'primary' } : {}),
      },
    ],
  })
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'supalens' }] })
  return blocks
}

/** The org's configured Slack incoming-webhook URL (owner/admin-set), or null. service_role read. */
export async function slackWebhookFor(orgId: string): Promise<string | null> {
  const admin = requireAdminClient()
  const { data } = await admin.from('org_slack_config').select('webhook_url').eq('org_id', orgId).limit(1)
  return (data?.[0] as { webhook_url: string } | undefined)?.webhook_url ?? null
}

/** POST a message to a Slack incoming webhook (`text` fallback + optional Block Kit `blocks`).
 *  Returns whether it was accepted. Never throws. */
export async function postSlack(webhookUrl: string, text: string, blocks?: unknown[]): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blocks && blocks.length > 0 ? { text, blocks } : { text }),
    })
    return res.ok
  } catch (e) {
    console.error('[slack] alert webhook post failed:', e)
    return false
  }
}
