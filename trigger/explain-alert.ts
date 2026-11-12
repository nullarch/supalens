import { task } from '@trigger.dev/sdk'

import './sentry'
import { runAlertExplanation, type ExplainAlertArgs } from '@/lib/alerts/explain'

/**
 * Root-cause "why did this alert fire" — reuses the read-only analysis agent (SUPALENS.md-aware),
 * writes the explanation onto the alert_event, and sends the ENRICHED notification. Fanned out by
 * the alert runner on a firing edge so the fast evaluation loop isn't blocked by an agent run.
 *
 * Retries are OFF: `runAlertExplanation` sends the notification, so a retry would double-notify (and
 * the agent isn't idempotent). A failed agent run still sends the plain fallback email inside the run.
 */
export const explainAlert = task({
  id: 'explain-alert',
  machine: 'medium-1x', // agent session + claude subprocess
  maxDuration: 900,
  queue: { concurrencyLimit: 2 }, // bound per data source (runner passes concurrencyKey: dataSourceId)
  retry: { maxAttempts: 1 },
  run: async (payload: ExplainAlertArgs) => {
    return runAlertExplanation(payload)
  },
})
