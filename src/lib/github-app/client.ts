// NOT `import 'server-only'` — shared with the Trigger.dev runtime (see config.ts).
import { GITHUB } from './config'
import { mintAppJwt } from './app-jwt'
import { getInstallationToken, GithubAppError } from './installation-token'

async function ghFetch(path: string, authorization: string): Promise<unknown> {
  const res = await fetch(`${GITHUB.apiBase}${path}`, {
    headers: {
      Authorization: authorization,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB.apiVersion,
    },
    cache: 'no-store',
  })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = (json as { message?: string })?.message ?? `github api ${path} failed (${res.status})`
    throw new GithubAppError(msg, res.status)
  }
  return json
}

export interface GithubInstallation {
  id: number
  account: { id: number; login: string; type: string } | null
  repository_selection: 'all' | 'selected'
}

/**
 * Verify an installation server-side using the App JWT. The `installation_id` arriving
 * on the OAuth callback is untrusted ("Bad actors can hit this URL with a spoofed
 * installation_id"); this call proves the installation exists and yields the real account.
 */
export async function getInstallation(installationId: number): Promise<GithubInstallation> {
  return (await ghFetch(`/app/installations/${installationId}`, `Bearer ${mintAppJwt()}`)) as GithubInstallation
}

export interface GithubRepo {
  id: number
  full_name: string
  private: boolean
  default_branch: string
  clone_url: string
}

/** List repositories accessible to an installation (installation token, paginated). */
export async function listInstallationRepos(installationId: number): Promise<GithubRepo[]> {
  const token = await getInstallationToken(installationId)
  const repos: GithubRepo[] = []
  // Cap at 10 pages (1000 repos) defensively; selected-repos installs are far smaller.
  for (let page = 1; page <= 10; page++) {
    const data = (await ghFetch(
      `/installation/repositories?per_page=100&page=${page}`,
      `token ${token}`
    )) as { total_count: number; repositories: GithubRepo[] }
    const batch = data.repositories ?? []
    repos.push(...batch)
    if (batch.length < 100) break
  }
  return repos
}
