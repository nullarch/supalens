// NOTE: intentionally NOT `import 'server-only'` — pure env config (the modules it reads are
// shared with the Trigger.dev bundle). The env names are not NEXT_PUBLIC_, so call this on the
// SERVER and hand the result to the browser (see IntegrationsProvider). Client components import
// the types and helpers from ./types, never this file — it pulls in the mail and provider modules.
import { emailConfigured } from '@/lib/email/resend'
import { githubAppConfigured } from '@/lib/github-app/config'
import { slackConfigured } from '@/lib/slack-app/config'
import { supabaseConnectConfigured } from '@/lib/supabase-oauth/config'
import type { IntegrationAvailability } from './types'

export type { IntegrationAvailability } from './types'

export function integrationAvailability(): IntegrationAvailability {
  return {
    supabaseConnect: supabaseConnectConfigured(),
    github: githubAppConfigured(),
    slack: slackConfigured(),
    email: emailConfigured(),
  }
}
