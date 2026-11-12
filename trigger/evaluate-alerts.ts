import { schedules, task } from '@trigger.dev/sdk'

import './sentry'
import { evaluateAlertsForDataSource, dueDataSourceIds } from '@/lib/alerts/runner'

/**
 * Alert evaluation on Trigger.dev.
 *
 * Two tasks by design:
 *  - `evaluate-alerts-cron` (scheduled): the tick. It does NO tenant DB work
 *    itself — it just discovers which data sources have enabled alerts and
 *    fans out one child run PER data source.
 *  - `evaluate-alerts-datasource`: evaluates every enabled alert for ONE data
 *    source, keyed by `concurrencyKey: dataSourceId` so a slow/hostile tenant DB
 *    can only ever occupy its own queue slot — it can't starve other tenants
 *    (mirrors trigger/analyze.ts's per-data-source concurrency bound).
 *
 * Unlike the `analyze` agent task (non-idempotent, retries disabled project-wide),
 * evaluation IS safe to retry: each alert persists its own state + dedupes on the
 * firing edge inside `evaluateAlert`, so a re-run re-evaluates from current state
 * rather than double-notifying. We therefore opt this task back into retries.
 */

export const evaluateAlertsForDataSourceTask = task({
  id: 'evaluate-alerts-datasource',
  machine: 'micro', // pure SQL scalar checks — no LLM, tiny footprint
  maxDuration: 300,
  // STRICTLY one evaluation per data source at a time (the queue is keyed by concurrencyKey:
  // dataSourceId). At 2, a killed/slow attempt overlapping the next cron tick ran the same
  // alerts concurrently — each read the alert state as a start-of-run snapshot, so both saw the
  // same firing edge → duplicate notifications + duplicate explain-alert LLM runs.
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 3 },
  run: async (payload: { dataSourceId: string }) => {
    const results = await evaluateAlertsForDataSource(payload.dataSourceId, Date.now())
    return {
      dataSourceId: payload.dataSourceId,
      evaluated: results.length,
      fired: results.filter((r) => r.edge === 'fired').length,
      resolved: results.filter((r) => r.edge === 'resolved').length,
      errors: results.filter((r) => !r.ok).length,
    }
  },
})

export const evaluateAlertsCron = schedules.task({
  id: 'evaluate-alerts-cron',
  // every 5 minutes — the interval for threshold/change-rate alerts. (Anomaly /
  // scheduled-report types, when added, get their own cadence.)
  cron: '*/5 * * * *',
  run: async () => {
    const ids = await dueDataSourceIds()
    if (ids.length === 0) return { fannedOut: 0 }

    // one child run per data source; concurrencyKey isolates each tenant DB.
    await evaluateAlertsForDataSourceTask.batchTrigger(
      ids.map((dataSourceId) => ({
        payload: { dataSourceId },
        options: { concurrencyKey: dataSourceId },
      })),
    )
    return { fannedOut: ids.length }
  },
})
