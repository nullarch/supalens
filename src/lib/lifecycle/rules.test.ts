import { describe, it, expect } from 'vitest'

import { ACTIVATION_MIN_KPIS, ACTIVATION_MIN_MONITORS, type ActivationInputs } from '@/lib/activation/logic'
import { pickNudge, type LifecycleContext } from './rules'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = 1_760_000_000_000

const noActivation: ActivationInputs = {
  realActiveSources: 1,
  reposAttached: 0,
  contextsGenerated: 0,
  kpisProposed: 0,
  kpisAccepted: 0,
  monitorsEnabled: 0,
  slackConnected: false,
  alertChannelConfigured: false,
}

function ctx(over: Partial<LifecycleContext>): LifecycleContext {
  return {
    now: NOW,
    orgCreatedAt: NOW - 3 * DAY,
    hasRealSource: false,
    firstRealSourceAt: null,
    firstRealSourceName: null,
    activation: null,
    ...over,
  }
}

/** A connected org, `sourceAgeH` hours after its first real source, with activation overrides. */
function connected(sourceAgeH: number, act: Partial<ActivationInputs>, over: Partial<LifecycleContext> = {}) {
  return ctx({
    hasRealSource: true,
    firstRealSourceAt: NOW - sourceAgeH * HOUR,
    firstRealSourceName: 'prod-db',
    activation: { ...noActivation, ...act },
    ...over,
  })
}

describe('pickNudge — L1 connectSource (signed up, no own data)', () => {
  it('fires 25h after signup with no real source', () => {
    const d = pickNudge(ctx({ orgCreatedAt: NOW - 25 * HOUR }))
    expect(d?.nudge).toBe('connectSource')
    expect(d?.kind).toBe('activate_connect_source')
    expect(d?.dedupeKey).toBe('activate_connect_source') // one-shot: dedupe == kind
  })
  it('holds back inside the first 24h', () => {
    expect(pickNudge(ctx({ orgCreatedAt: NOW - 10 * HOUR }))).toBeNull()
  })
  it('stops after the 30-day window (churn, not onboarding)', () => {
    expect(pickNudge(ctx({ orgCreatedAt: NOW - 31 * DAY }))).toBeNull()
  })
  it('the demo replay no longer matters — tryDemo is gone', () => {
    expect(pickNudge(ctx({ orgCreatedAt: NOW - 25 * HOUR }))?.nudge).toBe('connectSource')
  })
})

describe('pickNudge — L2 connectRepo (real DB, no code)', () => {
  it('fires 25h after connecting with no repo attached, carrying the source name', () => {
    const d = pickNudge(connected(25, {}))
    expect(d?.nudge).toBe('connectRepo')
    expect(d?.kind).toBe('activate_connect_repo')
    expect(d?.sourceName).toBe('prod-db')
  })
  it('holds back within 24h of connecting', () => {
    expect(pickNudge(connected(5, {}))).toBeNull()
  })
  it('never fires for a pending-only source (activation sees 0 active sources)', () => {
    expect(pickNudge(connected(30, { realActiveSources: 0 }))).toBeNull()
  })
  it('does not fire without activation inputs (sweep skipped them)', () => {
    expect(pickNudge(connected(30, {}, { activation: null }))).toBeNull()
  })
})

describe('pickNudge — L3 approveKpis (understood, not yet approved/monitored)', () => {
  it('fires 49h in when the repo + understanding exist but KPIs < 3', () => {
    const d = pickNudge(connected(49, { reposAttached: 1, contextsGenerated: 1, kpisProposed: 7, kpisAccepted: 1 }))
    expect(d?.nudge).toBe('approveKpis')
    expect(d?.kind).toBe('activate_approve_kpis')
    expect(d?.sourceName).toBe('prod-db')
  })
  it('also fires when KPIs are approved but fewer than 3 monitors are enabled', () => {
    const d = pickNudge(
      connected(49, {
        reposAttached: 1,
        contextsGenerated: 1,
        kpisAccepted: ACTIVATION_MIN_KPIS,
        monitorsEnabled: ACTIVATION_MIN_MONITORS - 1,
      }),
    )
    expect(d?.nudge).toBe('approveKpis')
  })
  it('holds back before 48h (the understanding may still be generating)', () => {
    expect(pickNudge(connected(30, { reposAttached: 1, contextsGenerated: 1 }))).toBeNull()
  })
  it('repo attached but no understanding yet → nothing (the system owes them, not vice versa)', () => {
    expect(pickNudge(connected(60, { reposAttached: 1, contextsGenerated: 0 }))).toBeNull()
  })
})

describe('pickNudge — L4 connectSlack (activated, email-only)', () => {
  const activated = {
    reposAttached: 1,
    contextsGenerated: 1,
    kpisAccepted: ACTIVATION_MIN_KPIS,
    monitorsEnabled: ACTIVATION_MIN_MONITORS,
  }
  it('fires once monitoring is live and no Slack/Discord channel exists', () => {
    const d = pickNudge(connected(3 * 24, activated))
    expect(d?.nudge).toBe('connectSlack')
    expect(d?.kind).toBe('activate_connect_slack')
  })
  it('is silent once any channel (bot channel, webhook, or Discord) is configured', () => {
    expect(pickNudge(connected(3 * 24, { ...activated, alertChannelConfigured: true }))).toBeNull()
    expect(pickNudge(connected(3 * 24, { ...activated, slackConnected: true }))).toBeNull()
  })
  it('stops 30 days after workspace creation', () => {
    expect(pickNudge(connected(3 * 24, activated, { orgCreatedAt: NOW - 31 * DAY }))).toBeNull()
  })
  it('outranks approveKpis — a fully monitored org never gets the KPI nudge', () => {
    expect(pickNudge(connected(3 * 24, activated))?.nudge).not.toBe('approveKpis')
  })
})

describe('pickNudge — ladder order and one-shot keys', () => {
  it('each stage has a distinct one-shot key (dedupe == kind)', () => {
    const keys = [
      pickNudge(ctx({ orgCreatedAt: NOW - 25 * HOUR })),
      pickNudge(connected(25, {})),
      pickNudge(connected(49, { reposAttached: 1, contextsGenerated: 1 })),
      pickNudge(
        connected(72, {
          reposAttached: 1,
          contextsGenerated: 1,
          kpisAccepted: ACTIVATION_MIN_KPIS,
          monitorsEnabled: ACTIVATION_MIN_MONITORS,
        }),
      ),
    ].map((d) => d?.kind)
    expect(keys).toEqual([
      'activate_connect_source',
      'activate_connect_repo',
      'activate_approve_kpis',
      'activate_connect_slack',
    ])
    expect(new Set(keys).size).toBe(4)
  })
  it('fully activated with Slack → nothing', () => {
    expect(
      pickNudge(
        connected(10 * 24, {
          reposAttached: 1,
          contextsGenerated: 1,
          kpisAccepted: 5,
          monitorsEnabled: 5,
          alertChannelConfigured: true,
        }),
      ),
    ).toBeNull()
  })
})
