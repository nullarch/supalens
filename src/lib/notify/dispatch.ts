// NOT `import 'server-only'` — runs on the Trigger.dev host (alerts runner + explain task).
// THE notification seam: alert call sites hand this a provider-neutral payload and it fans out
// to every configured channel. Adding Teams later = a new branch here + an adapter, NOT a
// change at the call sites (runner.ts / explain.ts stay untouched). Never throws.
import { requireAdminClient } from '@/utils/supabase/admin'
import { chatPostMessage } from '@/lib/slack-app/client'
import { botTokenForConnection } from '@/lib/slack-app/token'
import { slackWebhookFor, postSlack, formatAlertText, buildAlertBlocks, type AlertNotifyArgs } from './slack'
import { buildAlertEmbed, postDiscord } from './discord'

/**
 * Deliver an alert to every enabled channel for the org. Slack delivery prefers the connected BOT
 * (chat.postMessage to the picked channel); if no bot channel delivered, it falls back to the legacy
 * incoming-webhook (`org_slack_config`) so pre-bot users keep working. Discord channels are
 * INDEPENDENT deliveries, not part of that fallback chain — the legacy fallback is keyed on
 * Slack-only delivery (`slackSent`), so a Discord success never suppresses the org's Slack webhook.
 * Returns whether anything sent.
 */
export async function notifyChannels(orgId: string, args: AlertNotifyArgs): Promise<boolean> {
  // The whole body is guarded: botTokenForConnection → revealSecret CAN throw (vault/KEK/DB
  // fault, disconnect race), and a notify failure must never abort the alert runner or the
  // explain task — that is the contract the old notifySlack() had and call sites rely on.
  try {
    const admin = requireAdminClient()
    let slackSent = false
    let discordSent = false

    const { data } = await admin
      .from('notification_channels')
      .select('provider, target, connection_id')
      .eq('org_id', orgId)
      .in('provider', ['slack', 'discord'])
      .eq('enabled', true)
      .is('deleted_at', null)
    const channels = (data ?? []) as Array<{ provider: string; target: string; connection_id: string | null }>

    // 1. Slack bot channels (provider='slack', has a connection + target channel).
    //    Reveal each distinct connection's token once (channels usually share the bot).
    const slackText = await formatAlertText(args)
    const slackBlocks = await buildAlertBlocks(args)
    const tokens = new Map<string, string | null>()
    for (const ch of channels.filter((c) => c.provider === 'slack')) {
      if (!ch.connection_id) continue
      if (!tokens.has(ch.connection_id)) {
        try {
          tokens.set(ch.connection_id, await botTokenForConnection(ch.connection_id))
        } catch (e) {
          console.error('[notify] bot token reveal failed:', e)
          tokens.set(ch.connection_id, null)
        }
      }
      const token = tokens.get(ch.connection_id)
      if (token && (await chatPostMessage(token, { channel: ch.target, text: slackText, blocks: slackBlocks }))) slackSent = true
    }

    // 2. legacy Slack incoming-webhook fallback (only if the bot didn't deliver)
    if (!slackSent) {
      const url = await slackWebhookFor(orgId)
      if (url) slackSent = await postSlack(url, slackText, slackBlocks)
    }

    // 3. Discord webhooks (provider='discord', target=webhook URL) — delivered as an embed
    //    card (status color bar + root-cause field), not plain text; hence its own adapter.
    const discordChannels = channels.filter((c) => c.provider === 'discord')
    if (discordChannels.length > 0) {
      const embed = await buildAlertEmbed(args)
      for (const ch of discordChannels) {
        if (await postDiscord(ch.target, { embeds: [embed] })) discordSent = true
      }
    }

    return slackSent || discordSent
  } catch (e) {
    console.error('[notify] notifyChannels failed:', e)
    return false
  }
}
