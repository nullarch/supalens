import 'server-only'

// Public-repository metadata for the /x BFF: does the repo exist publicly, how big is it, what is
// the HEAD commit of its default branch (the cache key). Unauthenticated by default (60 req/h per
// server IP); set XRAY_GITHUB_TOKEN to a token with NO scopes for the 5,000 req/h budget. Only
// api.github.com is ever called, and only with a RepoRef that passed parseRepoInput.
import type { RepoRef } from './repo-ref'
import { xrayMaxRepoKb } from './config'

export interface PublicRepo {
  owner: string
  repo: string
  /** display casing, e.g. "Supabase/supabase" */
  fullName: string
  defaultBranch: string
  headSha: string
  sizeKb: number
  description: string | null
}

export type PublicRepoError = 'not_found' | 'too_large' | 'empty' | 'github_limited' | 'github_unavailable'

function headers(accept = 'application/vnd.github+json'): HeadersInit {
  const h: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'supalens-xray',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.XRAY_GITHUB_TOKEN?.trim()
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

function limited(res: Response): boolean {
  return (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0'
}

export async function fetchPublicRepo(ref: RepoRef): Promise<{ ok: true; repo: PublicRepo } | { ok: false; error: PublicRepoError }> {
  const base = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`
  let res: Response
  try {
    res = await fetch(base, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(8000) })
  } catch {
    return { ok: false, error: 'github_unavailable' }
  }
  if (res.status === 404 || res.status === 451) return { ok: false, error: 'not_found' }
  if (limited(res)) return { ok: false, error: 'github_limited' }
  if (!res.ok) return { ok: false, error: 'github_unavailable' }
  const meta = (await res.json().catch(() => null)) as {
    full_name?: string
    private?: boolean
    default_branch?: string
    size?: number
    description?: string | null
  } | null
  if (!meta?.full_name || meta.private) return { ok: false, error: 'not_found' }
  if ((meta.size ?? 0) > xrayMaxRepoKb()) return { ok: false, error: 'too_large' }
  const branch = meta.default_branch || 'main'

  let shaRes: Response
  try {
    shaRes = await fetch(`${base}/commits/${encodeURIComponent(branch)}`, {
      headers: headers('application/vnd.github.sha'),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { ok: false, error: 'github_unavailable' }
  }
  if (shaRes.status === 409 || shaRes.status === 404 || shaRes.status === 422) return { ok: false, error: 'empty' }
  if (limited(shaRes)) return { ok: false, error: 'github_limited' }
  if (!shaRes.ok) return { ok: false, error: 'github_unavailable' }
  const headSha = (await shaRes.text()).trim()
  if (!/^[0-9a-f]{40}$/i.test(headSha)) return { ok: false, error: 'github_unavailable' }

  const [owner, repo] = meta.full_name.split('/')
  return {
    ok: true,
    repo: {
      owner: owner.toLowerCase(),
      repo: repo.toLowerCase(),
      fullName: meta.full_name,
      defaultBranch: branch,
      headSha,
      sizeKb: meta.size ?? 0,
      description: meta.description ?? null,
    },
  }
}
