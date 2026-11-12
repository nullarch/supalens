import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the per-provider delivery semantics of notifyChannels:
 *  - Discord delivery must NEVER suppress the legacy Slack incoming-webhook fallback
 *    (the fallback is keyed on Slack-only delivery, not a global `sent` flag) — regression
 *    guard for the bug where one shared flag coupled independent providers.
 *  - A Slack bot delivery DOES suppress the legacy webhook (it's a fallback, not a dup).
 *  - Discord rows post the Discord-flavored text via postDiscord.
 */

let channelRows: Array<{ provider: string; target: string; connection_id: string | null }> = []

function selectChain() {
  const c = {
    eq: () => c,
    in: () => c,
    is: async () => ({ data: channelRows, error: null }),
  }
  return c
}

vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    from: () => ({ select: () => selectChain() }),
  }),
}))

const chatPostMessage = vi.fn(async () => true)
vi.mock('@/lib/slack-app/client', () => ({
  chatPostMessage: (...a: unknown[]) => chatPostMessage(...(a as [])),
}))

const botTokenForConnection = vi.fn(async () => 'xoxb-token')
vi.mock('@/lib/slack-app/token', () => ({
  botTokenForConnection: (...a: unknown[]) => botTokenForConnection(...(a as [])),
}))

const slackWebhookFor = vi.fn(async (): Promise<string | null> => null)
const postSlack = vi.fn(async () => true)
vi.mock('./slack', () => ({
  slackWebhookFor: (...a: unknown[]) => slackWebhookFor(...(a as [])),
  postSlack: (...a: unknown[]) => postSlack(...(a as [])),
  formatAlertText: async () => 'slack-text',
  buildAlertBlocks: async () => FAKE_BLOCKS,
}))

const FAKE_BLOCKS = [{ type: 'header' }]
const postDiscord = vi.fn(async () => true)
const FAKE_EMBED = { title: 't', description: 'd', color: 1 }
vi.mock('./discord', () => ({
  postDiscord: (...a: unknown[]) => postDiscord(...(a as [])),
  buildAlertEmbed: async () => FAKE_EMBED,
}))

import { notifyChannels } from './dispatch'

const ARGS = { kind: 'fired' as const, alertName: 'a', message: 'm' }

beforeEach(() => {
  channelRows = []
  chatPostMessage.mockClear().mockResolvedValue(true)
  botTokenForConnection.mockClear().mockResolvedValue('xoxb-token')
  slackWebhookFor.mockClear().mockResolvedValue(null)
  postSlack.mockClear().mockResolvedValue(true)
  postDiscord.mockClear().mockResolvedValue(true)
})

describe('notifyChannels per-provider delivery', () => {
  it('discord delivery does NOT suppress the legacy slack webhook fallback', async () => {
    channelRows = [{ provider: 'discord', target: 'https://discord.com/api/webhooks/1/x', connection_id: null }]
    slackWebhookFor.mockResolvedValue('https://hooks.slack.com/services/T/B/x')
    const sent = await notifyChannels('org1', ARGS)
    expect(sent).toBe(true)
    expect(postDiscord).toHaveBeenCalledWith('https://discord.com/api/webhooks/1/x', { embeds: [FAKE_EMBED] })
    // the legacy slack webhook must still fire — discord is independent, not a fallback consumer
    expect(postSlack).toHaveBeenCalledWith('https://hooks.slack.com/services/T/B/x', 'slack-text', FAKE_BLOCKS)
  })

  it('slack bot delivery suppresses the legacy webhook (fallback semantics kept)', async () => {
    channelRows = [{ provider: 'slack', target: 'C123', connection_id: 'conn1' }]
    slackWebhookFor.mockResolvedValue('https://hooks.slack.com/services/T/B/x')
    const sent = await notifyChannels('org1', ARGS)
    expect(sent).toBe(true)
    expect(chatPostMessage).toHaveBeenCalledWith('xoxb-token', { channel: 'C123', text: 'slack-text', blocks: FAKE_BLOCKS })
    expect(postSlack).not.toHaveBeenCalled()
  })

  it('slack + discord both configured → both deliver', async () => {
    channelRows = [
      { provider: 'slack', target: 'C123', connection_id: 'conn1' },
      { provider: 'discord', target: 'https://discord.com/api/webhooks/1/x', connection_id: null },
    ]
    const sent = await notifyChannels('org1', ARGS)
    expect(sent).toBe(true)
    expect(chatPostMessage).toHaveBeenCalledTimes(1)
    expect(postDiscord).toHaveBeenCalledTimes(1)
  })

  it('no channels at all → false, nothing posted', async () => {
    const sent = await notifyChannels('org1', ARGS)
    expect(sent).toBe(false)
    expect(chatPostMessage).not.toHaveBeenCalled()
    expect(postDiscord).not.toHaveBeenCalled()
    expect(postSlack).not.toHaveBeenCalled()
  })
})
