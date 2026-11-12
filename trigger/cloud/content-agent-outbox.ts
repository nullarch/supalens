import { schedules } from '@trigger.dev/sdk'

import '../sentry'
import { deliverContentAgentOutbox } from '@/lib/content-agent/sweep'

/**
 * content-agent tracking outbox delivery. Business events (signup, own_db_connected,
 * subscription_payment, refund) are persisted to content_agent_outbox where they happen; this
 * sweep POSTs the due ones to the content-agent ingress. A complete no-op until
 * CONTENT_AGENT_TRACKING_URL + CONTENT_AGENT_TRACKING_TOKEN are set on the Trigger host.
 *
 * Retries ON — unlike the notifying tasks, a re-run can't double-count: every event carries a
 * stable eventId and an identical replay is a duplicate at the ingress. One sweep at a time
 * (concurrencyLimit 1) so two overlapping runs never race the same rows.
 */
export const contentAgentOutboxCron = schedules.task({
  id: 'content-agent-outbox-cron',
  cron: '*/5 * * * *',
  machine: 'micro',
  maxDuration: 120,
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 3 },
  run: async () => {
    const report = await deliverContentAgentOutbox()
    if (report.requests > 0) {
      console.log(
        `[content-agent] due=${report.due} delivered=${report.delivered} (accepted=${report.accepted} duplicates=${report.duplicates}) failed=${report.failed} deferred=${report.deferred}${report.haltedBy ? ` halted=${report.haltedBy}` : ''}`,
      )
    }
    return report
  },
})
