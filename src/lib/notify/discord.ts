// NOT `import 'server-only'` — used by the Trigger.dev alert runner + explain task (plain Node
// bundle), same as ./slack.ts. Discord incoming-webhook primitives for alert notifications.
// Never throws: a delivery failure must not fail the evaluation run (same contract as postSlack).
import { alertDeepLink, type AlertNotifyArgs } from './slack'

/** Discord embed subset we emit (https://discord.com/developers/docs/resources/message#embed-object). */
export interface DiscordEmbed {
  title: string
  /** title hyperlink — deep-links the card to the incident (or the monitor as a fallback) */
  url?: string
  description: string
  /** decimal RGB — renders as the embed's left color bar */
  color: number
  author?: { name: string }
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  timestamp?: string
}

export interface DiscordWebhookPayload {
  content?: string
  embeds?: DiscordEmbed[]
}

// Discord's own status palette (danger red / success green) so the color bar reads natively.
const EMBED_COLOR = { fired: 0xed4245, resolved: 0x57f287 } as const

// Discord hard limits (400 on violation) — cap so a long alert name / message / AI explanation
// degrades to a truncated card instead of a silent delivery failure.
const TITLE_MAX = 256
const DESC_MAX = 4096
const FIELD_VALUE_MAX = 1024

const cap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

/**
 * Render an alert into a Discord embed card: status color bar + localized status header
 * (author line) + alert name title + message body + optional AI root-cause field +
 * timestamp/footer. Same localized labels (org locale) as the Slack/email paths.
 */
export async function buildAlertEmbed(args: AlertNotifyArgs): Promise<DiscordEmbed> {
  const { getServerTranslator } = await import('@/lib/i18n/server-translator')
  const t = await getServerTranslator(args.locale, 'emailAlert')
  const icon = args.kind === 'fired' ? '🔴' : '🟢'
  const embed: DiscordEmbed = {
    author: { name: t(args.kind === 'fired' ? 'headingFired' : 'headingResolved') },
    title: cap(`${icon} ${args.alertName}`, TITLE_MAX),
    url: alertDeepLink(args),
    description: cap(args.message, DESC_MAX),
    color: EMBED_COLOR[args.kind],
    footer: { text: 'supalens' },
    timestamp: new Date().toISOString(),
  }
  if (args.explanation) {
    embed.fields = [{ name: t('likelyCause'), value: cap(args.explanation, FIELD_VALUE_MAX) }]
  }
  return embed
}

/** POST a payload to a Discord incoming webhook (expects `{embeds|content}`, replies 204). Never throws. */
export async function postDiscord(webhookUrl: string, payload: DiscordWebhookPayload): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch (e) {
    console.error('[discord] alert webhook post failed:', e)
    return false
  }
}
