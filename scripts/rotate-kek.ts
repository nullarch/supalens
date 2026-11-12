/**
 * KEK rotation, phase 2 — re-wrap all DEKs under the current KEK.
 * See src/lib/crypto/rewrap.ts for the full runbook.
 *
 * Usage (env must carry SUPABASE_SERVICE_ROLE_KEY + the KEK_* vars):
 *   npx tsx --env-file=.env.local scripts/rotate-kek.ts
 */
import { rewrapAllDeks } from '../src/lib/crypto/rewrap'

rewrapAllDeks()
  .then((report) => {
    console.log(`re-wrapped ${report.rewrapped}/${report.total} DEKs`)
    if (report.failed.length > 0) {
      console.error('failures:')
      for (const f of report.failed) console.error(`  ${f.dekId}: ${f.error}`)
      process.exit(1)
    }
  })
  .catch((err) => {
    console.error('rewrap aborted:', err)
    process.exit(1)
  })
