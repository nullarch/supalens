// NOT `import 'server-only'` — pure, no io, and lives beside modules shared with the
// Trigger.dev runtime (see config.ts). Imported by a client component.
//
// Ranks an installation's repositories against a data source's name so the attach modal
// can put the two or three plausible repos on top instead of making the user scan a list
// of every repo their GitHub org owns. Deliberately conservative: a candidate is only
// labelled 추천 when it clears SUGGEST_THRESHOLD, so an unrelated repo is never promoted.

export interface RepoCandidate {
  id: string
  /** GitHub's "owner/repo". */
  fullName: string
}

/**
 * Words that carry no identity: every second repo/database is called "app" or "prod", so
 * matching on them would rank by noise. Stripped from BOTH sides before comparison.
 */
const STOPWORDS = new Set([
  'api',
  'app',
  'backend',
  'batch',
  'core',
  'db',
  'database',
  'dev',
  'development',
  'frontend',
  'main',
  'monorepo',
  'mysql',
  'postgres',
  'postgresql',
  'prod',
  'production',
  'repo',
  'server',
  'service',
  'services',
  'sql',
  'staging',
  'supabase',
  'test',
  'web',
  'www',
])

/** Score a repo must reach before it is shown as a suggestion rather than a plain list row. */
export const SUGGEST_THRESHOLD = 0.34

/**
 * Split an identifier into comparable lowercase tokens: separators, camelCase boundaries and
 * letter/digit boundaries all break. "DailyCart-prod_v2" → ["daily","cart","prod","v","2"].
 */
export function tokenize(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
}

/** Tokens with the generic ones removed; falls back to the raw tokens if all were generic. */
function meaningfulTokens(input: string): string[] {
  const all = tokenize(input)
  const kept = all.filter((t) => !STOPWORDS.has(t))
  return kept.length > 0 ? kept : all
}

/** The tokens joined — "daily-cart" and "dailyCart" both compress to "dailycart". */
function compress(tokens: string[]): string {
  return tokens.join('')
}

/** Sørensen–Dice over character bigrams. Robust to small typos and to word order. */
function diceBigrams(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const pairs = (s: string): string[] => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2))
  const left = pairs(a)
  const right = new Map<string, number>()
  for (const p of pairs(b)) right.set(p, (right.get(p) ?? 0) + 1)
  let hits = 0
  for (const p of left) {
    const n = right.get(p) ?? 0
    if (n > 0) {
      hits++
      right.set(p, n - 1)
    }
  }
  return (2 * hits) / (left.length + pairs(b).length)
}

/**
 * 0..1 similarity between a data source name and a repo identifier. Takes the strongest of
 * three signals rather than averaging them, because any ONE of them is convincing on its own:
 * identical after normalization, one name contained in the other, or high bigram overlap.
 */
export function similarity(sourceName: string, repoName: string): number {
  const a = meaningfulTokens(sourceName)
  const b = meaningfulTokens(repoName)
  if (a.length === 0 || b.length === 0) return 0
  const ca = compress(a)
  const cb = compress(b)
  if (ca === cb) return 1

  // Shared meaningful tokens ("dailycart-web" vs "dailycart-api" → "dailycart").
  const setB = new Set(b)
  const shared = a.filter((t) => setB.has(t))
  const overlap = shared.length > 0 ? (2 * shared.length) / (a.length + b.length) : 0

  // Containment only counts when the shorter side is substantial — "a" inside "analytics"
  // is a coincidence, "dailycart" inside "dailycart-internal" is not.
  const [shortS, longS] = ca.length <= cb.length ? [ca, cb] : [cb, ca]
  const contained = shortS.length >= 4 && longS.includes(shortS) ? 0.88 : 0

  return Math.max(overlap, contained, diceBigrams(ca, cb))
}

export interface RankedRepo<T extends RepoCandidate> {
  repo: T
  score: number
}

/**
 * Rank every repo against the source name and return them best-first with their score.
 * The repo's own name (the part after "owner/") is the primary signal; the full "owner/repo"
 * is a weaker secondary one, so an org whose name matches doesn't drag all its repos up.
 */
export function rankRepos<T extends RepoCandidate>(sourceName: string, repos: readonly T[]): RankedRepo<T>[] {
  const name = sourceName.trim()
  if (!name) return repos.map((repo) => ({ repo, score: 0 }))
  return repos
    .map((repo) => {
      const bare = repo.fullName.includes('/') ? repo.fullName.slice(repo.fullName.indexOf('/') + 1) : repo.fullName
      const score = Math.max(similarity(name, bare), similarity(name, repo.fullName) * 0.8)
      return { repo, score }
    })
    .sort((x, y) => y.score - x.score || x.repo.fullName.localeCompare(y.repo.fullName))
}

/**
 * The repos worth putting above the list. Empty when nothing clears the threshold — an
 * honest "no idea" beats three arbitrary rows wearing a 추천 badge.
 */
export function suggestRepos<T extends RepoCandidate>(
  sourceName: string,
  repos: readonly T[],
  topN = 3,
): T[] {
  return rankRepos(sourceName, repos)
    .filter((r) => r.score >= SUGGEST_THRESHOLD)
    .slice(0, topN)
    .map((r) => r.repo)
}
