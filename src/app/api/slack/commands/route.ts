import { getSlackAppConfig, slackConfigured } from '@/lib/slack-app/config'
import { verifySlackSignature } from '@/lib/slack-app/client'
import { checkUsageQuota } from '@/lib/plans/usage'
import { rateLimit } from '@/lib/rate-limit'
import { resolveOrgLocale } from '@/lib/i18n/resolve-locale'
import { createAgentRun } from '@/lib/agent/create-run'
import {
  APP_URL,
  describeSourceFailure,
  resolveSlackWorkspace,
  resolveDefaultDataSource,
  isChannelAllowed,
  stripMentions,
} from '@/lib/messenger/answer'
import { getServerTranslator } from '@/lib/i18n/server-translator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Slack shows this JSON as the immediate command reply (before the async answer). */
const ephemeral = (text: string) => Response.json({ response_type: 'ephemeral', text })

/**
 * `/supalens <question>` slash command. Unlike @mentions it works anywhere (incl. DMs) without the
 * bot being in the channel, and the answer is delivered via the per-invocation `response_url` (so
 * the messenger-answer task needs no bot token for this path). New LLM entry point → checkUsageQuota.
 *
 * Slack requires a 200 within 3s: we validate + queue synchronously, ack with an ephemeral
 * "analyzing…", and the Trigger task posts the real answer to response_url (valid ~30min).
 */
export async function POST(req: Request): Promise<Response> {
  if (!slackConfigured()) return new Response('slack_not_configured', { status: 503 })
  const cfg = getSlackAppConfig()

  const raw = await req.text()
  const ok = verifySlackSignature({
    signingSecret: cfg.signingSecret,
    signature: req.headers.get('x-slack-signature'),
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody: raw,
  })
  if (!ok) return new Response('bad_signature', { status: 401 })

  const form = new URLSearchParams(raw)
  const teamId = form.get('team_id') ?? ''
  const channel = form.get('channel_id') ?? ''
  const responseUrl = form.get('response_url') ?? ''
  const question = stripMentions(form.get('text') ?? '').trim()

  // pre-workspace messages fall back to English; once the org is known, its locale applies
  let t = await getServerTranslator(null, 'slackBot')
  if (!teamId || !responseUrl) return ephemeral(t('cannotProcess'))
  if (!rateLimit(`slack:${teamId}`, 30, 60_000).allowed) return ephemeral(t('rateLimited'))

  const ws = await resolveSlackWorkspace(teamId)
  if (!ws) return ephemeral(t('notConnected'))
  const locale = await resolveOrgLocale(ws.orgId)
  t = await getServerTranslator(locale, 'slackBot')

  if (channel && !isChannelAllowed(ws.allowedChannelIds, channel))
    return ephemeral(t('channelNotAllowedCommand'))

  if (!question) return ephemeral(t('emptyQuestionCommand'))

  const source = await resolveDefaultDataSource(ws.orgId)
  if (!source.ok) return ephemeral(describeSourceFailure(t, source))

  const quota = await checkUsageQuota(ws.orgId)
  if (!quota.allowed) return ephemeral(t('overQuota', { url: `${APP_URL}/app/settings/billing` }))

  const created = await createAgentRun({
    orgId: ws.orgId,
    dataSourceId: source.id,
    userId: null,
    question,
    channel: 'slack',
    taskId: 'messenger-answer',
    payloadExtra: {
      engine: source.engine,
      locale,
      reply: { provider: 'slack_response_url', responseUrl },
    },
  })

  switch (created.status) {
    case 'created':
      return ephemeral(t('analyzing'))
    case 'duplicate':
      return ephemeral(t('duplicate'))
    case 'no_worker':
      return ephemeral(t('unavailable'))
    default:
      return ephemeral(t('startFailed'))
  }
}
