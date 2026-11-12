// NOT `import 'server-only'` — shared with the Trigger.dev runtime (messenger-answer
// posts replies through chatPostMessage). Uses Node `crypto` for signature verify.
import { createHmac, timingSafeEqual } from 'crypto'

import { SLACK } from './config'

/** oauth.v2.access response (bot install). Only the fields we persist are typed. */
export interface SlackOAuthResult {
  botToken: string
  teamId: string
  teamName: string | null
  botUserId: string | null
  authedUserId: string | null
}

/**
 * Exchange the OAuth `code` for a bot token via oauth.v2.access. Slack returns HTTP 200
 * with `{ok:false, error}` on logical failures, so we check `ok` explicitly.
 */
export async function exchangeCode(args: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri?: string
}): Promise<SlackOAuthResult> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code: args.code,
  })
  if (args.redirectUri) body.set('redirect_uri', args.redirectUri)

  const res = await fetch(SLACK.oauthTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await res.json()) as {
    ok: boolean
    error?: string
    access_token?: string
    team?: { id?: string; name?: string }
    bot_user_id?: string
    authed_user?: { id?: string }
  }
  if (!json.ok || !json.access_token || !json.team?.id) {
    throw new Error(`slack oauth.v2.access failed: ${json.error ?? 'unknown_error'}`)
  }
  return {
    botToken: json.access_token,
    teamId: json.team.id,
    teamName: json.team.name ?? null,
    botUserId: json.bot_user_id ?? null,
    authedUserId: json.authed_user?.id ?? null,
  }
}

/** Post a message to a channel (or a thread reply when `threadTs` is set). Never throws. */
export async function chatPostMessage(
  botToken: string,
  args: { channel: string; text: string; threadTs?: string; blocks?: unknown[] }
): Promise<boolean> {
  try {
    const res = await fetch(`${SLACK.apiBase}/chat.postMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: args.channel,
        text: args.text,
        ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
        ...(args.blocks ? { blocks: args.blocks } : {}),
      }),
    })
    const json = (await res.json()) as { ok: boolean; error?: string }
    if (!json.ok) console.error('[slack] chat.postMessage failed:', json.error)
    return json.ok
  } catch (e) {
    console.error('[slack] chat.postMessage error:', e)
    return false
  }
}

/** List the workspace's channels for the alert-channel picker (bot must be a member to post). Never throws. */
export async function listConversations(botToken: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const url = new URL(`${SLACK.apiBase}/conversations.list`)
    url.searchParams.set('types', 'public_channel,private_channel')
    url.searchParams.set('exclude_archived', 'true')
    url.searchParams.set('limit', '200')
    const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } })
    const json = (await res.json()) as { ok: boolean; channels?: Array<{ id: string; name: string }> }
    if (!json.ok) return []
    return (json.channels ?? []).map((c) => ({ id: c.id, name: c.name }))
  } catch (e) {
    console.error('[slack] conversations.list error:', e)
    return []
  }
}

/** Add an emoji reaction (used as an instant ack on a mention). Never throws. */
export async function reactionsAdd(
  botToken: string,
  args: { channel: string; timestamp: string; name: string }
): Promise<void> {
  try {
    await fetch(`${SLACK.apiBase}/reactions.add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${botToken}` },
      body: JSON.stringify({ channel: args.channel, timestamp: args.timestamp, name: args.name }),
    })
  } catch (e) {
    console.error('[slack] reactions.add error:', e)
  }
}

/** Post to a slash command's response_url (valid ~30min, ≤5 uses; no bot-in-channel needed). Never throws. */
export async function postResponseUrl(
  responseUrl: string,
  text: string,
  responseType: 'in_channel' | 'ephemeral' = 'in_channel',
): Promise<boolean> {
  try {
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_type: responseType, text }),
    })
    return res.ok
  } catch (e) {
    console.error('[slack] response_url post failed:', e)
    return false
  }
}

/**
 * Verify a Slack Events API request signature (v0 scheme):
 *   base = `v0:${timestamp}:${rawBody}`; expected = `v0=` + HMAC-SHA256(signingSecret, base).
 * Rejects stale requests (>5 min) to blunt replay. Verify against the RAW body — parsing
 * first would change the bytes and break the HMAC (same rule as the Paddle/GitHub webhooks).
 */
export function verifySlackSignature(args: {
  signingSecret: string
  signature: string | null
  timestamp: string | null
  rawBody: string
}): boolean {
  const { signingSecret, signature, timestamp, rawBody } = args
  if (!signature || !timestamp) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false

  const expected = 'v0=' + createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}
