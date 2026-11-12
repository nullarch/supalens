import { schedules } from '@trigger.dev/sdk'

import '../sentry'
import { runLifecycleSweep } from '@/lib/lifecycle/sweep'

/**
 * Daily activation-email sweep (see src/lib/lifecycle/sweep.ts). Reads only
 * supalens's own DB + Resend — no tenant DB, no LLM — so unlike weekly-digest /
 * evaluate-alerts there is NO per-source fan-out (that fan-out only exists to
 * isolate hostile tenant DBs by concurrencyKey). Runs on a micro machine.
 *
 * Retries OFF — it sends email, so a retry would double-send. (The claim-before-
 * send ledger is a second guard, but retries-off matches weekly-digest /
 * messenger-answer and avoids relying on the ledger alone.)
 */
export const lifecycleEmailsCron = schedules.task({
  id: 'lifecycle-emails-cron',
  cron: '0 9 * * *', // daily 09:00 UTC (18:00 KST) — nudges aren't minute-critical
  machine: 'micro',
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async () => runLifecycleSweep(),
})
