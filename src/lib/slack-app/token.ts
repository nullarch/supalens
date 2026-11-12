// NOT `import 'server-only'` — used by the events route (BFF) AND the messenger-answer
// Trigger task. Both have KEK access (the connect callback already encrypts the token here).
import { requireAdminClient } from '@/utils/supabase/admin'
import { revealSecret } from '@/lib/secrets/service'

/**
 * Reveal the active bot token for a Slack provider_connection from the vault, or null if the
 * workspace has no stored token (e.g. mid-disconnect). The token lives ONLY here at call time —
 * never in a payload, model context, or subprocess (same invariant as the GitHub installation token).
 */
export async function botTokenForConnection(connectionId: string): Promise<string | null> {
  const admin = requireAdminClient()
  // is_current matters: putSecret demotes a rotated token to is_current=false but leaves
  // status='active', so without this filter a re-install could resolve the STALE token.
  const { data } = await admin
    .from('secrets')
    .select('id')
    .eq('connection_id', connectionId)
    .eq('kind', 'slack_bot_token')
    .eq('status', 'active')
    .eq('is_current', true)
    .limit(1)
  const secretId = (data?.[0] as { id: string } | undefined)?.id
  if (!secretId) return null
  return revealSecret(secretId, { actor: { kind: 'system' }, purpose: 'slack_post' })
}
