import { task } from '@trigger.dev/sdk'

import './sentry'
import { type AnalysisResult } from '@/lib/agent/run-analysis'
import { runByEngine } from '@/lib/agent/run-by-engine'
import { markRunning, persistRun, persistFailedRun } from '@/lib/agent/run-record'
import { chatPostMessage, postResponseUrl } from '@/lib/slack-app/client'
import { botTokenForConnection } from '@/lib/slack-app/token'
import { APP_URL, type MessengerAnswerPayload, type ReplyRef } from '@/lib/messenger/answer'
import { getServerTranslator, type ServerT } from '@/lib/i18n/server-translator'

/**
 * Answer an `@supalens` mention from a work messenger. Reuses the SAME read-only analysis agent
 * as the web/MCP paths (engine dispatch: firestore → runFirestoreAnalysis, else runAnalysis),
 * persists the run (which meters usage via persistRun — demo excluded), then posts the answer back.
 *
 * Retries are OFF: this task posts to Slack, so a retry would double-post (same reasoning as
 * explain-alert). persistRun runs EXACTLY once per outcome — the catch path only persists when
 * the try path hasn't (a double persist would double-bill via increment_org_usage), and the
 * reply post sits OUTSIDE the persist decision so a Slack/vault fault can't corrupt the record.
 */
export const messengerAnswer = task({
  id: 'messenger-answer',
  machine: 'medium-1x', // agent session + claude subprocess
  maxDuration: 3600,
  queue: { concurrencyLimit: 2 }, // bound per data source (events route passes concurrencyKey)
  retry: { maxAttempts: 1 },
  run: async (payload: MessengerAnswerPayload) => {
    const t = await getServerTranslator(payload.locale, 'slackBot')
    let replyText = t('answerError')
    let persisted = false
    let result: AnalysisResult | undefined
    try {
      // claim failed → the run was cancelled/reaped before we started; skip both the agent
      // run AND the reply (a cancelled mention must not get a late answer).
      if (!(await markRunning(payload.runId))) {
        return { skipped: 'not_claimable' }
      }
      const args = {
        orgId: payload.orgId,
        dataSourceId: payload.dataSourceId,
        userId: '', // unused by the runners (actor = { system, runId }); no supalens user for a Slack mention
        runId: payload.runId,
        question: payload.question,
        locale: payload.locale,
      }
      result = await runByEngine(payload.engine, args)

      await persistRun(payload.runId, result)
      persisted = true
      replyText =
        result.ok && result.text.trim()
          ? formatAnswer(result.text, payload.runId, t)
          : t('answerIncomplete')
    } catch (err) {
      if (!persisted) {
        await persistFailedRun(payload.runId, err).catch(() => {})
      }
      await postReply(payload.reply, replyText).catch(() => {})
      throw err
    }

    // best-effort reply — a Slack/vault fault here must not fail (or re-persist) a finished run
    try {
      await postReply(payload.reply, replyText)
    } catch (err) {
      console.error('[messenger-answer] reply post failed:', err)
    }
    return result
  },
})

/** Slack has a per-message size limit; trim and append a link to the full run in the app. */
function formatAnswer(text: string, runId: string, t: ServerT): string {
  const link = `${APP_URL}/app/ask/history/${runId}`
  const max = 2800
  const body = text.length > max ? text.slice(0, max) + '…' : text
  return `${body}\n\n<${link}|${t('fullResult')}>`
}

async function postReply(reply: ReplyRef, text: string): Promise<void> {
  if (reply.provider === 'slack_response_url') {
    await postResponseUrl(reply.responseUrl, text)
    return
  }
  // provider === 'slack' — post via the bot token to the channel/thread
  const token = await botTokenForConnection(reply.connectionId).catch(() => null)
  if (!token) return
  await chatPostMessage(token, { channel: reply.channel, text, threadTs: reply.threadTs })
}
