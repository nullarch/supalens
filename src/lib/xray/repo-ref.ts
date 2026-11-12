// Pure parsing of what a visitor types into the /x box. NOT server-only (the form validates the
// same way before posting). The result is the ONLY thing that ever builds a GitHub URL, so the
// grammar is strict: GitHub's own owner/repo character sets, github.com as the only host.

export interface RepoRef {
  /** lowercased — the cache and URL key */
  owner: string
  repo: string
}

// GitHub logins: alphanumerics and single inner hyphens, ≤ 39 chars.
const OWNER_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i
// Repository names: letters, digits, '.', '-', '_' (≤ 100), but never '.' or '..'.
const REPO_RE = /^[a-z0-9._-]{1,100}$/i

/**
 * Accepts `owner/repo`, `github.com/owner/repo`, `https://github.com/owner/repo(.git)`,
 * `git@github.com:owner/repo.git`, and deep links (`…/tree/main/src`) — the first two path
 * segments win. Anything naming another host, or an invalid owner/repo, is rejected (null).
 */
export function parseRepoInput(raw: string): RepoRef | null {
  let s = raw.trim()
  if (!s || s.length > 300) return null
  s = s.replace(/^git@github\.com:/i, '')
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s)
  if (hasScheme && !/^https?:\/\/(www\.)?github\.com\//i.test(s)) return null
  s = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?github\.com\//i, '')
  if (/^[^/]*\.[a-z]{2,}\//i.test(s) && !hasScheme) {
    // "gitlab.com/x/y" typed without a scheme — another host
    return null
  }
  s = s.replace(/[?#].*$/, '')
  const parts = s.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]
  const repo = parts[1].replace(/\.git$/i, '')
  if (!OWNER_RE.test(owner)) return null
  if (!REPO_RE.test(repo) || repo === '.' || repo === '..') return null
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase() }
}

/** The canonical /x path for a repo (lowercased, unprefixed — callers add the locale). */
export function xrayPath(ref: RepoRef): string {
  return `/x/${ref.owner}/${ref.repo}`
}

// Repo names that say nothing about the product ("acme/app", "acme/web") — the owner reads better.
const GENERIC_REPO = /^(app|apps|web|website|site|api|server|backend|frontend|client|core|main|platform|monorepo|product|saas|dashboard|mobile|service|src)$/i

/** The name a sentence should use for the product: the report's own name when it has one,
 *  else the repo name, unless that name is generic (then the owner). */
export function productNameFor(owner: string, repo: string, reported?: string | null): string {
  if (reported?.trim()) return reported.trim()
  return GENERIC_REPO.test(repo) ? owner : repo
}
