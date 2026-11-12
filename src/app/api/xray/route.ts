import { randomUUID } from 'crypto'

import { auth, tasks } from '@trigger.dev/sdk'
import { NextResponse } from 'next/server'
import { getLocale } from 'next-intl/server'

import { clientIpFrom, hashDemoIp } from '@/lib/demo/public-demo'
import { isSupportedLocale } from '@/lib/i18n/negotiate'
import {
  xrayConfigured,
  xrayMaxInFlight,
  xrayMaxScansPerDay,
  xrayScansPerVisitorPerDay,
} from '@/lib/xray/config'
import { fetchPublicRepo } from '@/lib/xray/github'
import { parseRepoInput, xrayPath } from '@/lib/xray/repo-ref'
import {
  countInflight,
  countScansSince,
  countVisitorScansSince,
  failScan,
  findCachedScan,
  findInflight,
  findLatestSucceeded,
  insertScan,
  setTriggerRun,
} from '@/lib/xray/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VISITOR_COOKIE = 'sl_xray_id'

async function runToken(triggerRunId: string): Promise<string> {
  return auth.createPublicToken({ scopes: { read: { runs: [triggerRunId] } }, expirationTime: '2h' })
}

/**
 * Start (or join, or serve from cache) an X-ray of a PUBLIC GitHub repository. Anonymous LLM
 * entry point — the same posture as /api/demo/ask: the client sends only a repo string and a
 * display locale, every gate fails CLOSED, and the cache path costs nothing.
 *
 * Gate order: parse → GitHub (exists, public, size, HEAD sha) → cache (same commit + locale) →
 * join an in-flight scan → "already X-rayed" offer (older commit, unless `rescan`) → per-visitor
 * window → global daily budget → in-flight cap → insert (one in-flight row per repo+locale) →
 * trigger → run-scoped public token.
 */
export async function POST(req: Request) {
  if (!xrayConfigured()) return NextResponse.json({ error: 'unavailable' }, { status: 503 })

  let body: { repo?: string; locale?: string; rescan?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const ref = parseRepoInput(String(body.repo ?? ''))
  if (!ref) return NextResponse.json({ error: 'invalid_repo' }, { status: 400 })
  const locale = isSupportedLocale(body.locale) ? body.locale : await getLocale()

  const cookieHeader = req.headers.get('cookie') ?? ''
  const existingCookieId = cookieHeader.match(new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([\\w-]+)`))?.[1] ?? null
  const cookieId = existingCookieId ?? randomUUID()
  const respond = (payload: Record<string, unknown>, status = 200) => {
    const res = NextResponse.json(payload, { status })
    if (!existingCookieId) {
      res.cookies.set(VISITOR_COOKIE, cookieId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      })
    }
    return res
  }

  // 1. GitHub: public, not too big, has a default-branch commit
  const gh = await fetchPublicRepo(ref)
  if (!gh.ok) {
    const status = gh.error === 'not_found' ? 404 : gh.error === 'too_large' || gh.error === 'empty' ? 422 : 503
    return respond({ error: gh.error, path: xrayPath(ref) }, status)
  }
  const repo = gh.repo
  const path = xrayPath(repo)

  // 2. cache — exactly this commit, this locale: free
  const cached = await findCachedScan(repo.owner, repo.repo, repo.headSha, locale)
  if (cached) return respond({ mode: 'cached', path, reportId: cached.id })

  // 3. someone is scanning this repo right now — join their stream instead of paying twice
  const inflight = await findInflight(repo.owner, repo.repo, locale)
  if (inflight) return respond({ mode: 'running', path, reportId: inflight.id })

  // 4. an older commit was X-rayed: offer it first (the visitor opts into a fresh scan)
  if (!body.rescan) {
    const previous = await findLatestSucceeded(repo.owner, repo.repo, locale)
    if (previous) {
      return respond({ mode: 'stale', path, reportId: previous.id, scannedSha: previous.commitSha, scannedAt: previous.completedAt })
    }
  }

  // 5. per-visitor window, 6. global budget, 7. in-flight cap — each fails closed
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const ipHash = hashDemoIp(clientIpFrom(req.headers))
  const visitorScans = await countVisitorScansSince(ipHash, cookieId, since)
  if (visitorScans === null) return respond({ error: 'unavailable' }, 503)
  if (visitorScans >= xrayScansPerVisitorPerDay()) return respond({ error: 'rate_limited' }, 429)

  const globalScans = await countScansSince(since)
  if (globalScans === null) return respond({ error: 'unavailable' }, 503)
  if (globalScans >= xrayMaxScansPerDay()) return respond({ error: 'daily_budget' }, 429)

  const inFlight = await countInflight()
  if (inFlight === null) return respond({ error: 'unavailable' }, 503)
  if (inFlight >= xrayMaxInFlight()) return respond({ error: 'busy', ahead: inFlight }, 429)

  // 8. one in-flight row per repo+locale (unique index) — a race loser joins the winner
  const inserted = await insertScan({
    owner: repo.owner,
    repo: repo.repo,
    fullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    commitSha: repo.headSha,
    locale,
    ipHash,
    cookieId,
  })
  if (!inserted) return respond({ error: 'unavailable' }, 503)
  if ('conflict' in inserted) {
    const winner = await findInflight(repo.owner, repo.repo, locale)
    return winner ? respond({ mode: 'running', path, reportId: winner.id }) : respond({ error: 'busy' }, 429)
  }

  let triggerRunId: string
  try {
    const handle = await tasks.trigger(
      'xray-scan',
      { reportId: inserted.id, fullName: repo.fullName, defaultBranch: repo.defaultBranch, locale },
      { tags: [`xray:${repo.owner}/${repo.repo}`] },
    )
    triggerRunId = handle.id
  } catch (err) {
    console.error('[xray] trigger failed:', String(err).slice(0, 200))
    await failScan(inserted.id, 'trigger_failed')
    return respond({ error: 'unavailable' }, 503)
  }
  await setTriggerRun(inserted.id, triggerRunId)

  return respond({ mode: 'live', path, reportId: inserted.id, triggerRunId, publicToken: await runToken(triggerRunId) })
}
