import { randomUUID } from 'crypto'

import { auth } from '@trigger.dev/sdk'
import { NextResponse } from 'next/server'
import { getLocale } from 'next-intl/server'

import { createAgentRun } from '@/lib/agent/create-run'
import { taskIdForEngine } from '@/lib/agent/engine'
import { ensureDemoSource } from '@/lib/data-sources/demo'
import {
  DEMO_MAX_QUESTION_CHARS,
  clientIpFrom,
  demoConcurrencyKey,
  demoMaxInFlight,
  demoMaxRunsPerDay,
  demoRunsPerVisitorPerDay,
  hashDemoIp,
  normalizeDemoQuestion,
  publicDemoConfigured,
  publicDemoOrgId,
} from '@/lib/demo/public-demo'
import {
  countDemoRunsSince,
  countInFlightDemoRuns,
  countVisitorRunsSince,
  findCachedDemoAnswer,
  recordDemoRequest,
  triggerRunIdFor,
} from '@/lib/demo/service'
import { isSupportedLocale } from '@/lib/i18n/negotiate'
import { checkUsageQuota } from '@/lib/plans/usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VISITOR_COOKIE = 'sl_demo_id'

/**
 * Anonymous ask endpoint for the public /demo page (docs/public-demo-plan.md). This is an LLM
 * entry point with NO auth, so every gate here fails CLOSED and the tenant is never chosen by
 * the client: the org comes from PUBLIC_DEMO_ORG_ID and the data source from ensureDemoSource —
 * the request body carries only the question (+ display locale).
 *
 * Gate order: validate → cache (free, consumes no limits) → per-visitor window → global daily
 * budget → checkUsageQuota (the new-LLM-entry-point invariant; its 24h org cap is the backstop)
 * → in-flight cap → create run → ledger + run-scoped public token.
 */
export async function POST(req: Request) {
  if (!publicDemoConfigured()) {
    return NextResponse.json({ error: 'demo_unconfigured' }, { status: 503 })
  }
  const orgId = publicDemoOrgId()!

  let body: { question?: string; locale?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const question = normalizeDemoQuestion(body.question ?? '')
  if (!question) return NextResponse.json({ error: 'missing_question' }, { status: 400 })
  if (question.length > DEMO_MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: 'question_too_long' }, { status: 400 })
  }
  const locale = isSupportedLocale(body.locale) ? body.locale : await getLocale()

  // visitor identity — read the cookie up front so cache hits also keep a stable id
  const cookieHeader = req.headers.get('cookie') ?? ''
  const existingCookieId = cookieHeader.match(new RegExp(`(?:^|;\\s*)${VISITOR_COOKIE}=([\\w-]+)`))?.[1] ?? null
  const cookieId = existingCookieId ?? randomUUID()
  const withVisitorCookie = (res: NextResponse) => {
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

  // 1. cache — the free path. Chips always land here after their first live run.
  const cached = await findCachedDemoAnswer(orgId, question)
  if (cached) {
    return withVisitorCookie(
      NextResponse.json({ mode: 'cached', runId: cached.runId, result: cached.result, answeredAt: cached.answeredAt }),
    )
  }

  // 2. per-visitor sliding window (fail closed: a broken counter must not open the endpoint)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const ipHash = hashDemoIp(clientIpFrom(req.headers))
  const visitorRuns = await countVisitorRunsSince(ipHash, cookieId, since)
  if (visitorRuns === null) return NextResponse.json({ error: 'demo_unavailable' }, { status: 503 })
  if (visitorRuns >= demoRunsPerVisitorPerDay()) {
    return withVisitorCookie(NextResponse.json({ error: 'rate_limited' }, { status: 429 }))
  }

  // 3. global daily budget (own ledger count), then the org-level gate — checkUsageQuota is
  // the shared abuse backstop (24h run cap; monthly metering stays untouched because demo
  // runs are excluded from the increment in persistRun).
  const globalRuns = await countDemoRunsSince(since)
  if (globalRuns === null) return NextResponse.json({ error: 'demo_unavailable' }, { status: 503 })
  if (globalRuns >= demoMaxRunsPerDay()) {
    return withVisitorCookie(NextResponse.json({ error: 'daily_budget' }, { status: 429 }))
  }
  const quota = await checkUsageQuota(orgId, { locale })
  if (!quota.allowed) {
    return withVisitorCookie(NextResponse.json({ error: 'daily_budget' }, { status: 429 }))
  }

  // 4. in-flight cap — beyond it the UI steers to cached suggestions instead of queueing
  const inFlight = await countInFlightDemoRuns(orgId)
  if (inFlight === null || inFlight >= demoMaxInFlight()) {
    return withVisitorCookie(NextResponse.json({ error: 'busy' }, { status: 429 }))
  }

  // live runs need the Trigger worker — checked BEFORE creating the row so no orphan queued
  // rows pile up in local dev (the app's SSE fallback requires auth, which this surface lacks)
  if (!process.env.TRIGGER_SECRET_KEY) {
    return NextResponse.json({ error: 'demo_unavailable' }, { status: 503 })
  }

  const dataSourceId = await ensureDemoSource(orgId)
  if (!dataSourceId) return NextResponse.json({ error: 'demo_unavailable' }, { status: 503 })

  const created = await createAgentRun({
    orgId,
    dataSourceId,
    userId: null,
    question,
    channel: 'web', // the public demo is still the web composer, just unauthenticated
    taskId: taskIdForEngine('postgres'),
    payloadExtra: { locale },
    concurrencyKey: demoConcurrencyKey(cookieId + question),
  })

  switch (created.status) {
    case 'duplicate': {
      // Someone is asking the identical question right now — join their stream rather than
      // erroring (no ledger row: this visitor spawned no run).
      const dupTriggerId = await triggerRunIdFor(created.runId)
      if (!dupTriggerId) return withVisitorCookie(NextResponse.json({ mode: 'pending', runId: created.runId }, { status: 202 }))
      const dupToken = await auth.createPublicToken({ scopes: { read: { runs: [dupTriggerId] } }, expirationTime: '2h' })
      return withVisitorCookie(
        NextResponse.json({ mode: 'trigger', runId: created.runId, triggerRunId: dupTriggerId, publicToken: dupToken }),
      )
    }
    case 'insert_failed':
    case 'no_worker':
      return NextResponse.json({ error: 'demo_unavailable' }, { status: 503 })
    case 'trigger_failed':
      return NextResponse.json({ error: 'run_failed' }, { status: 502 })
  }

  await recordDemoRequest({ ipHash, cookieId, question, runId: created.runId })

  // run-scoped public token: read on ONLY this run's stream (same shape as /api/agent/analyze)
  const publicToken = await auth.createPublicToken({
    scopes: { read: { runs: [created.triggerRunId] } },
    expirationTime: '2h',
  })
  return withVisitorCookie(
    NextResponse.json({ mode: 'trigger', runId: created.runId, triggerRunId: created.triggerRunId, publicToken }),
  )
}
