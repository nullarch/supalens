// NOT `import 'server-only'` — keep symmetry with the rest of github-app/*.
import { requireAdminClient } from '@/utils/supabase/admin'
import { invalidateInstallationToken } from './installation-token'

/**
 * Disconnect a GitHub connection: soft-delete its repositories + the connection and
 * drop the cached installation token. There is NO stored secret to revoke and NO API
 * to uninstall on the user's behalf — the actual App uninstall is user-driven on GitHub
 * (the `installation.deleted` webhook also routes here). v1 keeps this simple.
 */
export async function disconnectGithub(connectionId: string): Promise<{ ok: boolean }> {
  const admin = requireAdminClient()

  const { data, error } = await admin
    .from('provider_connections')
    .select('id, installation_id')
    .eq('id', connectionId)
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) return { ok: true }
  const installationId = (data[0] as { installation_id: number | null }).installation_id

  const now = new Date().toISOString()
  await admin
    .from('github_repositories')
    .update({ status: 'disabled', deleted_at: now })
    .eq('connection_id', connectionId)
    .is('deleted_at', null)
  await admin
    .from('provider_connections')
    .update({ status: 'revoked', deleted_at: now })
    .eq('id', connectionId)

  if (installationId != null) invalidateInstallationToken(installationId)
  return { ok: true }
}
