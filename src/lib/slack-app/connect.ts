// NOT `import 'server-only'` — keep symmetry with the rest of slack-app/*.
import { requireAdminClient } from '@/utils/supabase/admin'
import { putSecret } from '@/lib/secrets/service'
import { exchangeCode } from './client'
import { getSlackAppConfig } from './config'

export interface SlackConnectResult {
  connectionId: string
  teamId: string
  teamName: string | null
}

/**
 * Finalize a Slack workspace connection:
 *   1. exchange the OAuth `code` for a bot token (server-side; the code is untrusted),
 *   2. upsert the provider_connection (provider='slack', team_id in external_account_id),
 *   3. store the bot token in the vault (secret_kind='slack_bot_token', parent=connection).
 *
 * Runs under the service-role admin client (BYPASSRLS) with explicit org filters.
 */
/** Thrown when a workspace is already connected to a different org (one team = one org). */
export class WorkspaceAlreadyConnectedError extends Error {
  constructor() {
    super('slack workspace is already connected to another organization')
    this.name = 'WorkspaceAlreadyConnectedError'
  }
}

export async function connectSlackWorkspace(args: {
  orgId: string
  userId: string
  code: string
  /** MUST equal the redirect_uri sent on the authorize leg (Slack verifies the pair). */
  redirectUri: string
}): Promise<SlackConnectResult> {
  const cfg = getSlackAppConfig()
  const admin = requireAdminClient()

  // 1. exchange code → bot token + team identity. redirect_uri must match the authorize
  //    request exactly, so the caller passes the SAME value the authorize route derived.
  const oauth = await exchangeCode({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    code: args.code,
    redirectUri: args.redirectUri,
  })

  // 2. one team = one org (tenant boundary — mentions resolve team_id → org). If ANY other
  //    org holds a live connection for this workspace, refuse with a friendly error; the
  //    pc_slack_team_live unique index is the hard backstop underneath this check.
  const { data: existing, error: findErr } = await admin
    .from('provider_connections')
    .select('id, org_id')
    .eq('provider', 'slack')
    .eq('external_account_id', oauth.teamId)
    .is('deleted_at', null)
    .limit(1)
  if (findErr) throw findErr
  if (existing && existing.length > 0 && (existing[0] as { org_id: string }).org_id !== args.orgId) {
    throw new WorkspaceAlreadyConnectedError()
  }

  let connectionId: string
  if (existing && existing.length > 0) {
    connectionId = (existing[0] as { id: string }).id
    await admin
      .from('provider_connections')
      .update({ display_name: oauth.teamName, status: 'active' })
      .eq('id', connectionId)
  } else {
    const { data: ins, error: insErr } = await admin
      .from('provider_connections')
      .insert({
        org_id: args.orgId,
        provider: 'slack',
        external_account_id: oauth.teamId,
        display_name: oauth.teamName,
        status: 'active',
        created_by: args.userId,
      })
      .select('id')
    if (insErr) throw insErr
    connectionId = (ins![0] as { id: string }).id
  }

  // 3. store the bot token in the vault (demotes any previous current token for this connection)
  await putSecret({
    orgId: args.orgId,
    kind: 'slack_bot_token',
    plaintext: oauth.botToken,
    parent: { connectionId },
    actor: { kind: 'user', id: args.userId },
  })

  return { connectionId, teamId: oauth.teamId, teamName: oauth.teamName }
}
