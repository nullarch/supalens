import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { alertDeepLink, buildAlertBlocks, formatAlertText, monitorLink } from './slack'
import { buildAlertEmbed } from './discord'

/**
 * Pins the notification deep-link contract: a notification that knows its FIRED alert_events row
 * lands the reader on the INCIDENT (where ack / snooze / cause feedback live), and falls back to
 * the monitor — never the bare list — whenever it doesn't. Every channel adapter must agree, so
 * the Slack text, the Block Kit button and the Discord embed are all asserted here.
 */

const ORIGIN = 'https://app.example.com'

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGIN
})
afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe('alertDeepLink', () => {
  it('prefers the incident when the event id is known', () => {
    expect(alertDeepLink({ alertId: 'a1', eventId: 'e1' })).toBe(`${ORIGIN}/app/incidents/e1`)
  })

  it('falls back to the monitor, then the list', () => {
    expect(alertDeepLink({ alertId: 'a1', eventId: null })).toBe(`${ORIGIN}/app/monitors/a1`)
    expect(alertDeepLink({})).toBe(`${ORIGIN}/app/monitors`)
    expect(monitorLink('a1')).toBe(`${ORIGIN}/app/monitors/a1`)
  })
})

describe('channel adapters carry the same link', () => {
  const args = { kind: 'fired' as const, alertName: 'daily revenue', message: 'below 1,000', locale: 'en', alertId: 'a1', eventId: 'e1' }

  it('slack text and the Block Kit button both point at the incident', async () => {
    expect(await formatAlertText(args)).toContain(`${ORIGIN}/app/incidents/e1`)
    const blocks = (await buildAlertBlocks(args)) as Array<{ type: string; elements?: Array<{ url?: string }> }>
    const actions = blocks.find((b) => b.type === 'actions')
    expect(actions?.elements?.[0]?.url).toBe(`${ORIGIN}/app/incidents/e1`)
  })

  it('the discord embed title links to the incident', async () => {
    expect((await buildAlertEmbed(args)).url).toBe(`${ORIGIN}/app/incidents/e1`)
  })

  it('a resolved edge with no event row still reaches its monitor', async () => {
    const resolved = { kind: 'resolved' as const, alertName: 'a', message: 'm', locale: 'en', alertId: 'a1' }
    expect(await formatAlertText(resolved)).toContain(`${ORIGIN}/app/monitors/a1`)
    expect((await buildAlertEmbed(resolved)).url).toBe(`${ORIGIN}/app/monitors/a1`)
  })
})
