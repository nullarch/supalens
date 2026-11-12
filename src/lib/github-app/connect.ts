// NOT `import 'server-only'` — keep symmetry with the rest of github-app/*.
import * as Sentry from '@sentry/nextjs'

import { requireAdminClient } from '@/utils/supabase/admin'
import { getInstallation, listInstallationRepos, type GithubRepo } from './client'

export interface GithubConnectResult {
  connectionId: string
  repoCount: number
}

/** Thrown when the installation is already bound to a different org (one installation = one org).
 *  Guards against a caller claiming another tenant's installation_id (which the App JWT can read
 *  for ANY installation) and rebinding its repos under their own org. */
export class InstallationClaimedByAnotherOrgError extends Error {
  constructor() {
    super('github installation is already connected to another organization')
    this.name = 'InstallationClaimedByAnotherOrgError'
  }
}

/**
 * Finalize a GitHub App connection:
 *   1. server-verify the installation (App JWT) — the callback's installation_id is untrusted,
 *   2. upsert the provider_connection (provider='github', one per installation) — NO secret,
 *   3. list installation repos and upsert github_repositories.
 *
 * Runs under the service-role admin client (BYPASSRLS) with explicit org filters.
 */
export async function connectGithubInstallation(args: {
  orgId: string
  userId: string
  installationId: number
}): Promise<GithubConnectResult> {
  const admin = requireAdminClient()

  // 1. verify installation + resolve the real GitHub account
  const installation = await getInstallation(args.installationId)
  const accountLogin = installation.account?.login ?? null
  const accountId = installation.account?.id != null ? String(installation.account.id) : null

  // 2. upsert provider_connection by installation_id (explicit find→update/insert because
  //    the installation_id unique index is partial — onConflict can't target it).
  const { data: existing, error: findErr } = await admin
    .from('provider_connections')
    .select('id, org_id')
    .eq('installation_id', args.installationId)
    .is('deleted_at', null)
    .limit(1)
  if (findErr) throw findErr

  // one installation = one org (tenant boundary). If a live connection for this installation
  // already belongs to a DIFFERENT org, refuse — otherwise a caller who guessed/enumerated the
  // installation_id would rebind the victim's connection (and its private repos) to their org.
  // Mirrors connectSlackWorkspace's WorkspaceAlreadyConnectedError guard.
  if (existing && existing.length > 0 && (existing[0] as { org_id: string }).org_id !== args.orgId) {
    throw new InstallationClaimedByAnotherOrgError()
  }

  let connectionId: string
  if (existing && existing.length > 0) {
    connectionId = (existing[0] as { id: string }).id
    await admin
      .from('provider_connections')
      .update({
        org_id: args.orgId,
        external_account_id: accountId,
        display_name: accountLogin,
        status: 'active',
      })
      .eq('id', connectionId)
  } else {
    const { data: ins, error: insErr } = await admin
      .from('provider_connections')
      .insert({
        org_id: args.orgId,
        provider: 'github',
        external_account_id: accountId,
        display_name: accountLogin,
        installation_id: args.installationId,
        status: 'active',
        created_by: args.userId,
      })
      .select('id')
    if (insErr) throw insErr
    connectionId = (ins![0] as { id: string }).id
  }

  // 3. upsert repositories
  const repos = await listInstallationRepos(args.installationId)
  let repoCount = 0
  for (const repo of repos) {
    try {
      await upsertRepo(admin, {
        orgId: args.orgId,
        connectionId,
        userId: args.userId,
        repo,
      })
      repoCount++
    } catch (err) {
      console.error(`[connect-github] upsert repo ${repo.full_name} failed:`, err)
      Sentry.captureException(err, { tags: { repo: repo.full_name } })
    }
  }

  return { connectionId, repoCount }
}

async function upsertRepo(
  admin: ReturnType<typeof requireAdminClient>,
  args: { orgId: string; connectionId: string; userId: string; repo: GithubRepo }
): Promise<void> {
  const row = {
    org_id: args.orgId,
    connection_id: args.connectionId,
    github_repo_id: args.repo.id,
    full_name: args.repo.full_name,
    default_branch: args.repo.default_branch || 'main',
    is_private: args.repo.private,
    clone_url: args.repo.clone_url,
    status: 'active',
  }

  const { data: existing } = await admin
    .from('github_repositories')
    .select('id')
    .eq('org_id', args.orgId)
    .eq('github_repo_id', args.repo.id)
    .is('deleted_at', null)
    .limit(1)

  if (existing && existing.length > 0) {
    await admin.from('github_repositories').update(row).eq('id', (existing[0] as { id: string }).id)
  } else {
    await admin.from('github_repositories').insert({ ...row, created_by: args.userId })
  }
}
