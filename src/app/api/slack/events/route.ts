import { requireAdminClient } from '@/utils/supabase/admin'
import { checkUsageQuota } from '@/lib/plans/usage'
import { rateLimit } from '@/lib/rate-limit'
import { resolveOrgLocale } from '@/lib/i18n/resolve-locale'
import { createAgentRun } from '@/lib/agent/create-run'
import { getSlackAppConfig, slackConfigured } from '@/lib/slack-app/config'
import { verifySlackSignature, chatPostMessage, reactionsAdd } from '@/lib/slack-app/client'
import { botTokenForConnection } from '@/lib/slack-app/token'
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

// Always 200 so Slack stops retrying (an error status triggers redelivery). We only 401/503
// when we could NOT authenticate the request at all — those are never valid deliveries to ack.
const OK = () => new Response('ok', { status: 200 })

/**
 * Slack Events API endpoint (`@supalens …` mentions). A NEW LLM entry point, so it gates on
 * checkUsageQuota (SKIP-and-inform rather than 402 — Slack must get a 200 or it retries).
 *
 * Order matters: verify signature on the RAW body → rate limit (free, before any I/O) →
 * dedupe by event_id → resolve org → quota → insert agent_runs → hand off to the
 * messenger-answer task → 200. The heavy work (the agent run + posting the reply) happens on
 * the Trigger host, so we ack well within Slack's 3s window. If processing fails AFTER the
 * dedupe row was written, the row is deleted again so a re-mention can be processed —
 * otherwise a transient fault would permanently swallow the question.
 */
export async function POST(req: Request): Promise<Response> {
  if (!slackConfigured()) return new Response('slack_not_configured', { status: 503 })
  const cfg = getSlackAppConfig()

  // 1. verify signature against the RAW body (parsing first would break the HMAC).
  const raw = await req.text()
  const ok = verifySlackSignature({
    signingSecret: cfg.signingSecret,
    signature: req.headers.get('x-slack-signature'),
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody: raw,
  })
  if (!ok) return new Response('bad_signature', { status: 401 })

  let body: {
    type?: string
    challenge?: string
    team_id?: string
    event_id?: string
    event?: {
      type?: string
      text?: string
      channel?: string
      ts?: string
      thread_ts?: string
      bot_id?: string
      subtype?: string
    }
  }
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response('bad_json', { status: 400 })
  }

  // 2. URL verification handshake (one-time, when registering the Events request URL).
  if (body.type === 'url_verification' && body.challenge) {
    return Response.json({ challenge: body.challenge })
  }

  const ev = body.event
  // Only mentions; ignore anything from a bot (loop guard) or without the fields we need.
  if (body.type !== 'event_callback' || ev?.type !== 'app_mention' || ev.bot_id || ev.subtype) return OK()
  const teamId = body.team_id
  const eventId = body.event_id
  const channel = ev.channel
  if (!teamId || !eventId || !channel) return OK()

  // 3. per-workspace rate limit — in-memory and free, so it runs BEFORE any DB work
  //    (a rate-limited burst must shed load, not add lookups + dedupe-table writes).
  if (!rateLimit(`slack:${teamId}`, 30, 60_000).allowed) return OK()

  const admin = requireAdminClient()

  // 4. resolve the workspace → org + connection (the tenant boundary).
  const ws = await resolveSlackWorkspace(teamId)
  if (!ws) return OK() // bot installed but no active connection we know of — ignore

  // 5. idempotency: record the event_id; a duplicate delivery (Slack retry) no-ops.
  const { error: dupErr } = await admin.from('slack_events').insert({ event_id: eventId, org_id: ws.orgId })
  if (dupErr) {
    // 23505 = unique_violation → already processed. Any other error: ack anyway (don't invite retries).
    return OK()
  }

  const locale = await resolveOrgLocale(ws.orgId)
  const t = await getServerTranslator(locale, 'slackBot')

  const threadTs = ev.thread_ts ?? ev.ts
  const reply = { provider: 'slack' as const, connectionId: ws.connectionId, channel, threadTs }
  // One vault reveal per request, shared by the ack reaction and every postBack (a reveal
  // is a KMS unwrap + audit write — repeating it burns the 3s ack budget and the audit log).
  let tokenPromise: Promise<string | null> | undefined
  const getToken = () => (tokenPromise ??= botTokenForConnection(ws.connectionId).catch(() => null))
  const postBack = async (text: string) => {
    const token = await getToken()
    if (token) await chatPostMessage(token, { channel, text, threadTs })
  }

  try {
    // channel allowlist (owner/admin scoping). Empty allowlist → any channel (default trust model).
    if (!isChannelAllowed(ws.allowedChannelIds, channel)) {
      await postBack(t('channelNotAllowedMention'))
      return OK()
    }

    const question = stripMentions(ev.text ?? '')
    if (!question) {
      await postBack(t('emptyQuestionMention'))
      return OK()
    }

    // 6. pick the data source (one real → auto; several → ask on the web; none → demo).
    const source = await resolveDefaultDataSource(ws.orgId)
    if (!source.ok) {
      await postBack(describeSourceFailure(t, source))
      return OK()
    }

    // 7. quota gate (metered + abuse cap). Over budget → inform in-thread, still 200.
    const quota = await checkUsageQuota(ws.orgId)
    if (!quota.allowed) {
      await postBack(t('overQuota', { url: `${APP_URL}/app/settings/billing` }))
      return OK()
    }

    // 8. create + dispatch the run (shared: double-submit guard → insert → trigger messenger-answer).
    const created = await createAgentRun({
      orgId: ws.orgId,
      dataSourceId: source.id,
      userId: null, // no supalens user behind a Slack mention (workspace = org trust, v1)
      question,
      channel: 'slack',
      taskId: 'messenger-answer',
      payloadExtra: {
        engine: source.engine,
        locale, // answer in the org's language (best-effort)
        reply,
      },
    })

    if (created.status === 'created') {
      const token = await getToken()
      if (token && ev.ts) await reactionsAdd(token, { channel, timestamp: ev.ts, name: 'eyes' })
    } else if (created.status === 'duplicate') {
      await postBack(t('duplicate'))
    } else if (created.status === 'no_worker') {
      console.warn('[slack/events] TRIGGER_SECRET_KEY unset — mention not processed')
      await postBack(t('unavailable'))
    } else {
      await postBack(t('startFailed'))
    }

    return OK()
  } catch (err) {
    // Processing failed AFTER consuming the event_id: release it so a re-mention (or Slack
    // retry of a slow-but-unacked delivery) can be processed instead of vanishing forever.
    console.error('[slack/events] processing failed:', err)
    await admin.from('slack_events').delete().eq('event_id', eventId).then(
      () => {},
      () => {},
    )
    await postBack(t('processingError')).catch(() => {})
    return OK()
  }
}
