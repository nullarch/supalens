import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the sweep's per-owner isolation against a THROWING `getActivationInputs`.
 *
 * `activation/state.ts` now throws on a real DB fault (only a missing schema — 42703/42P01 —
 * degrades to 0), and those inputs are the entire decision surface of the nudge ladder. So a
 * failed read must skip that owner outright: never pick a nudge from a half-built context, never
 * burn the one-shot claim, and — crucially — never stop the sweep, which mails everyone else.
 */

const getActivationInputs = vi.fn()
vi.mock('@/lib/activation/state', () => ({
  getActivationInputs: (...a: unknown[]) => getActivationInputs(...(a as [])),
}))

type ClaimArgs = { orgId: string; userId: string; kind: string; dedupeKey: string }
const claimSend = vi.fn<(admin: unknown, args: ClaimArgs) => Promise<boolean>>()
const releaseClaim = vi.fn<(admin: unknown, args: { userId: string; dedupeKey: string }) => Promise<void>>()
const sentCountLastNDays = vi.fn<(admin: unknown, userId: string, days: number) => Promise<number>>()
vi.mock('./send-log', () => ({
  claimSend: (...a: Parameters<typeof claimSend>) => claimSend(...a),
  releaseClaim: (...a: Parameters<typeof releaseClaim>) => releaseClaim(...a),
  sentCountLastNDays: (...a: Parameters<typeof sentCountLastNDays>) => sentCountLastNDays(...a),
}))

const sendLifecycleEmail = vi.fn<(args: Record<string, unknown>) => Promise<{ sent: boolean; reason?: string }>>()
vi.mock('@/lib/email/lifecycle', () => ({
  sendLifecycleEmail: (...a: Parameters<typeof sendLifecycleEmail>) => sendLifecycleEmail(...a),
}))

vi.mock('@/lib/i18n/resolve-locale', () => ({ resolveUserLocale: async () => 'en' }))
vi.mock('@sentry/node', () => ({ captureException: (...a: unknown[]) => captureException(...(a as [])) }))
const captureException = vi.fn()

const DAY = 86_400_000
const now = Date.UTC(2026, 8, 5)

/** Two orgs, each with one owner and one real (non-demo) source aged into the L2/L3 window. */
const orgs = [
  { id: 'org-broken', name: 'Broken', created_at: new Date(now - 5 * DAY).toISOString() },
  { id: 'org-ok', name: 'Fine', created_at: new Date(now - 5 * DAY).toISOString() },
]
const owners = orgs.map((o) => ({
  org_id: o.id,
  user_id: `user-${o.id}`,
  email_lifecycle_opt_out: false,
  profiles: { email: `${o.id}@example.com`, locale: 'en' },
}))
const sources = orgs.map((o) => ({
  id: `src-${o.id}`,
  org_id: o.id,
  name: 'Prod DB',
  is_demo: false,
  created_at: new Date(now - 3 * DAY).toISOString(),
  status: 'active',
  deleted_at: null,
}))

let orgPage = 0

vi.mock('@/utils/supabase/admin', () => ({
  requireAdminClient: () => ({
    from: (table: string) => {
      if (table === 'organizations') {
        return {
          select: () => ({
            is: () => ({
              order: () => ({
                // one full page, then an empty one to end the scan
                range: async () => ({ data: orgPage++ === 0 ? orgs : [], error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'organization_members') {
        return { select: () => ({ in: () => ({ eq: async () => ({ data: owners, error: null }) }) }) }
      }
      if (table === 'data_sources') {
        return { select: () => ({ in: async () => ({ data: sources, error: null }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { runLifecycleSweep } from './sweep'

/** Inputs that put the org at L2 (real DB, no repo attached) → pickNudge returns connectRepo. */
const ACTIVATION_L2 = {
  realActiveSources: 1,
  reposAttached: 0,
  contextsGenerated: 0,
  kpisProposed: 0,
  kpisAccepted: 0,
  monitorsEnabled: 0,
  slackConnected: false,
  alertChannelConfigured: false,
}

beforeEach(() => {
  orgPage = 0
  getActivationInputs.mockReset()
  claimSend.mockReset().mockResolvedValue(true)
  releaseClaim.mockReset().mockResolvedValue(undefined)
  sentCountLastNDays.mockReset().mockResolvedValue(0)
  sendLifecycleEmail.mockReset().mockResolvedValue({ sent: true })
  captureException.mockClear()
})

describe('runLifecycleSweep — a throwing getActivationInputs', () => {
  it('skips only that owner: no nudge picked, no claim burned, no mail', async () => {
    getActivationInputs.mockImplementation(async (_client: unknown, orgId: string) => {
      if (orgId === 'org-broken') throw new Error('connection terminated unexpectedly')
      return ACTIVATION_L2
    })

    const report = await runLifecycleSweep(now)

    // the healthy org still got its nudge — one failure does not sink the sweep
    expect(sendLifecycleEmail).toHaveBeenCalledTimes(1)
    expect(sendLifecycleEmail.mock.calls[0][0]).toMatchObject({
      orgId: 'org-ok',
      nudge: 'connectRepo',
    })
    // the broken org never reached the claim (which is a ONE-SHOT — burning it loses the nudge)
    expect(claimSend).toHaveBeenCalledTimes(1)
    expect(claimSend.mock.calls[0][1]).toMatchObject({ orgId: 'org-ok', kind: 'activate_connect_repo' })
    expect(releaseClaim).not.toHaveBeenCalled()

    // and the fault is surfaced, not swallowed
    expect(report.scanned).toBe(1)
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toContain('org-broken')
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(report.sent).toEqual({ activate_connect_repo: 1 })
  })

  it('sends nothing at all when every org fails, and still returns a report', async () => {
    getActivationInputs.mockRejectedValue(new Error('permission denied for table alerts'))

    const report = await runLifecycleSweep(now)

    expect(sendLifecycleEmail).not.toHaveBeenCalled()
    expect(claimSend).not.toHaveBeenCalled()
    expect(report.scanned).toBe(0)
    expect(report.errors).toHaveLength(2)
  })
})
