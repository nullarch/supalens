import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildAlertEmbed, postDiscord } from './discord'

/**
 * Pins the Discord embed contract: status color bar (Discord's danger red / success green),
 * alert name in the title, localized status header, the AI root-cause as a field, and the
 * hard caps (title 256 / description 4096 / field value 1024) so a long explanation degrades
 * to a truncated card instead of a 400. postDiscord ships the payload verbatim, never throws.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildAlertEmbed', () => {
  it('fired → red color bar, 🔴 title with the alert name, localized header', async () => {
    const e = await buildAlertEmbed({ kind: 'fired', alertName: 'daily rev', message: 'm', locale: 'en' })
    expect(e.color).toBe(0xed4245)
    expect(e.title).toBe('🔴 daily rev')
    expect(e.author?.name).toBe('Alert firing')
    expect(e.description).toBe('m')
    expect(e.footer?.text).toBe('supalens')
    expect(e.timestamp).toBeTruthy()
    expect(e.fields).toBeUndefined()
  })

  it('resolved → green color bar + 🟢', async () => {
    const e = await buildAlertEmbed({ kind: 'resolved', alertName: 'a', message: 'm', locale: 'en' })
    expect(e.color).toBe(0x57f287)
    expect(e.title).toContain('🟢')
    expect(e.author?.name).toBe('Alert resolved')
  })

  it('explanation rides as a root-cause field, capped at 1024', async () => {
    const e = await buildAlertEmbed({
      kind: 'fired',
      alertName: 'a',
      message: 'm',
      explanation: 'x'.repeat(3000),
      locale: 'en',
    })
    expect(e.fields).toHaveLength(1)
    expect(e.fields![0].name).toContain('Likely cause')
    expect(e.fields![0].value.length).toBeLessThanOrEqual(1024)
    expect(e.fields![0].value.endsWith('…')).toBe(true)
  })

  it('caps title (256) and description (4096) under Discord limits', async () => {
    const e = await buildAlertEmbed({
      kind: 'fired',
      alertName: 'n'.repeat(500),
      message: 'm'.repeat(9000),
      locale: 'ko',
    })
    expect(e.title.length).toBeLessThanOrEqual(256)
    expect(e.description.length).toBeLessThanOrEqual(4096)
  })
})

describe('postDiscord', () => {
  it('POSTs the payload verbatim ({embeds}) and returns res.ok', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const payload = { embeds: [{ title: 't', description: 'd', color: 1 }] }
    const ok = await postDiscord('https://discord.com/api/webhooks/1/x', payload)
    expect(ok).toBe(true)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(JSON.parse(init.body)).toEqual(payload)
  })

  it('never throws on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('down'))))
    await expect(
      postDiscord('https://discord.com/api/webhooks/1/x', { embeds: [] }),
    ).resolves.toBe(false)
  })
})
