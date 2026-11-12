// NOT `import 'server-only'` — keep symmetry with the rest of slack-app/*.
import { requireAdminClient } from '@/utils/supabase/admin'
import { revealSecret, revokeSecret } from '@/lib/secrets/service'
import { SLACK } from './config'

/**
 * Disconnect a Slack workspace:
 *   1. best-effort revoke the bot token at Slack (auth.revoke),
 *   2. revoke the stored token secret(s) in the vault,
 *   3. disable notification_channels that post through this connection (soft-delete —
 *      the migration's ON DELETE is inert here; §4 of core-dev-guard),
 *   4. soft-delete the provider_connection.
 */
export async function disconnectSlack(connectionId: string): Promise<{ ok: boolean }> {
  const admin = requireAdminClient()

  // provider filter matters: this teardown is Slack-shaped (vault revoke + channel disable).
  // Without it, a wrong connectionId (UI bug, crafted form post) could soft-delete a
  // Supabase/GitHub connection while SKIPPING that provider's own cleanup obligations.
  const { data: conn } = await admin
    .from('provider_connections')
    .select('id, org_id')
    .eq('id', connectionId)
    .eq('provider', 'slack')
    .is('deleted_at', null)
    .limit(1)
  if (!conn || conn.length === 0) return { ok: true }

  // 1 + 2. revoke each active bot-token secret for this connection. Each secret is handled
  // in one guarded unit — a vault fault on one must not abort the teardown (leaving an
  // 'active' connection with a dead token).
  const { data: secrets } = await admin
    .from('secrets')
    .select('id')
    .eq('connection_id', connectionId)
    .eq('kind', 'slack_bot_token')
    .eq('status', 'active')
  for (const s of (secrets ?? []) as Array<{ id: string }>) {
    try {
      const token = await revealSecret(s.id, { actor: { kind: 'system' }, purpose: 'slack_disconnect' })
      await slackAuthRevoke(token) // best-effort; token is dead in the vault regardless
    } catch (e) {
      console.error('[slack] token revoke (Slack side) failed:', e)
    }
    try {
      await revokeSecret(s.id, { reason: 'slack_disconnect', actor: { kind: 'system' } })
    } catch (e) {
      console.error('[slack] vault revoke failed:', e)
    }
  }

  const now = new Date().toISOString()
  // 3. disable channels routed through this connection
  await admin
    .from('notification_channels')
    .update({ enabled: false, deleted_at: now })
    .eq('connection_id', connectionId)
    .is('deleted_at', null)
  // 4. soft-delete the connection
  await admin.from('provider_connections').update({ status: 'revoked', deleted_at: now }).eq('id', connectionId)

  return { ok: true }
}

/** Best-effort Slack auth.revoke. Never throws (the vault revoke is the source of truth). */
async function slackAuthRevoke(botToken: string): Promise<void> {
  await fetch(`${SLACK.apiBase}/auth.revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}` },
  })
}
