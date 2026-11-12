import { describe, expect, it } from 'vitest'

import {
  WIZARD_TOTAL_STEPS,
  actAfterConnect,
  exitCompletes,
  initialAct,
  kpiActVariant,
  onboardingConnectHref,
  onboardingModalAllowedOn,
  onboardingModalDismissKey,
  homeChecklistCoversOnboarding,
  shouldShowWizard,
  wizardDismissKey,
  wizardMode,
} from './logic'

describe('shouldShowWizard', () => {
  it('shows only for never-completed users with zero runs', () => {
    expect(shouldShowWizard({ wizardCompletedAt: null, runCount: 0 })).toBe(true)
  })
  it('never shows once completed (any run count)', () => {
    expect(shouldShowWizard({ wizardCompletedAt: '2026-08-02T00:00:00Z', runCount: 0 })).toBe(false)
  })
  it('never interrupts a user who already has activity — the backfill-straggler guard', () => {
    expect(shouldShowWizard({ wizardCompletedAt: null, runCount: 1 })).toBe(false)
  })
})

describe('exitCompletes (dismiss vs complete)', () => {
  it('PIN: only the real endings stamp completion', () => {
    expect(exitCompletes('extract_started')).toBe(true)
    expect(exitCompletes('tour_done')).toBe(true)
  })
  it('PIN: ✕ / ESC / skips / later / browse are dismissals, never completions', () => {
    for (const r of ['dismissed', 'act1_skipped', 'act3_skipped', 'act4_skipped', 'browse', 'sample_connect', 'code_attach']) {
      expect(exitCompletes(r)).toBe(false)
    }
  })
  it('dismissal is remembered per user (key carries the user id)', () => {
    expect(wizardDismissKey('u1')).not.toBe(wizardDismissKey('u2'))
  })
})

describe('wizardMode', () => {
  it('full journey for a fresh org', () => {
    expect(wizardMode({ hasRealSources: false })).toBe('full')
  })
  it("tour-only for invitees — never ask them to connect a DB to someone else's org", () => {
    expect(wizardMode({ hasRealSources: true })).toBe('tour')
  })
})

describe('initialAct (OAuth round-trip resume)', () => {
  it('starts at act 1 normally', () => {
    expect(initialAct({ resume: false, hasRealSources: false })).toBe(1)
    expect(initialAct({ resume: false, hasRealSources: true })).toBe(1)
  })
  it('resume with a connection made lands on the code step (skips are always forward)', () => {
    expect(initialAct({ resume: true, hasRealSources: true })).toBe(3)
  })
  it('resume WITHOUT a connection (aborted OAuth) re-opens act 2, not act 1', () => {
    expect(initialAct({ resume: true, hasRealSources: false })).toBe(2)
  })
})

describe('actAfterConnect / kpiActVariant', () => {
  it('the code step only exists when there is a DB to attach code to', () => {
    expect(actAfterConnect({ hasRealSources: true })).toBe(3)
    expect(actAfterConnect({ hasRealSources: false })).toBe(4)
    expect(WIZARD_TOTAL_STEPS).toBe(4)
  })
  it('connected → real extraction proposal; skipped → sample catalog', () => {
    expect(kpiActVariant({ hasRealSources: true })).toBe('extract')
    expect(kpiActVariant({ hasRealSources: false })).toBe('sample')
  })
})

describe('homeChecklistCoversOnboarding (who the home checklist already onboards)', () => {
  it('is true for owners/admins of a workspace with zero real sources — no tour on top of it', () => {
    expect(homeChecklistCoversOnboarding({ role: 'owner', realSourceCount: 0 })).toBe(true)
    expect(homeChecklistCoversOnboarding({ role: 'admin', realSourceCount: 0 })).toBe(true)
    expect(homeChecklistCoversOnboarding({ role: 'member', realSourceCount: 0 })).toBe(false)
    expect(homeChecklistCoversOnboarding({ role: 'viewer', realSourceCount: 0 })).toBe(false)
    expect(homeChecklistCoversOnboarding({ role: 'owner', realSourceCount: 1 })).toBe(false)
  })

  it('claims nothing when the source count is unknown', () => {
    expect(homeChecklistCoversOnboarding({ role: 'owner', realSourceCount: null })).toBe(false)
    expect(homeChecklistCoversOnboarding({ role: null, realSourceCount: 0 })).toBe(false)
  })

  it('stays off the connect surfaces it hands off to', () => {
    expect(onboardingModalAllowedOn('/app/overview')).toBe(true)
    expect(onboardingModalAllowedOn('/app/ask')).toBe(true)
    expect(onboardingModalAllowedOn('/app/setup')).toBe(false)
    expect(onboardingModalAllowedOn('/app/sources')).toBe(false)
    expect(onboardingModalAllowedOn('/app/sources/s1/kpis')).toBe(false)
    expect(onboardingModalAllowedOn('/app/sourcesx')).toBe(true)
  })

  it('hands each database to its real connect flow', () => {
    expect(onboardingConnectHref('supabase')).toBe('/api/connect-supabase/authorize?returnTo=/app/setup')
    expect(onboardingConnectHref('postgresql')).toBe('/app/sources?connect=postgres')
    expect(onboardingConnectHref('mysql')).toBe('/app/sources?connect=mysql')
    expect(onboardingConnectHref('firestore')).toBe('/app/sources?connect=firestore')
  })

  it('remembers a dismissal per workspace', () => {
    expect(onboardingModalDismissKey('org-a')).not.toBe(onboardingModalDismissKey('org-b'))
  })
})
