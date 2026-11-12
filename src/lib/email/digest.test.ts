import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the consolidated digest email: exactly ONE message per recipient (not one per source),
 * and EVERY source section is rendered into both the html and text parts — guards a template
 * regression that would silently drop sources from the combined digest. escapeHtml is NOT
 * mocked, so the rendered output is exercised for real.
 */

const send = vi.fn()
vi.mock('./resend', () => ({
  getResendClient: () => ({ emails: { send: (...a: unknown[]) => send(...(a as [])) } }),
  emailFrom: () => 'Supalens <digest@supalens.ai>',
  emailReplyTo: () => undefined,
  emailLang: (l?: string) => (l === 'ko' || l === 'ja' ? l : 'en'),
}))

vi.mock('../i18n/server-translator', () => ({
  getServerTranslator: async () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}(${Object.values(vals).join(',')})` : key,
}))

vi.mock('./unsubscribe', () => ({
  unsubscribeUrl: () => 'https://supalens.ai/api/email/unsubscribe?token=x',
}))

import { sendDigestEmail } from './digest'

const sections = [
  { name: 'Prod DB', summary: 'revenue up 12%' },
  { name: 'Analytics', summary: 'signups flat' },
  { name: 'Events', summary: 'errors down' },
]

beforeEach(() => {
  send.mockReset().mockResolvedValue({ error: null })
})

describe('sendDigestEmail — consolidation', () => {
  it('sends ONE email per recipient covering every section', async () => {
    const res = await sendDigestEmail({
      to: [
        { email: 'a@x.com', userId: 'u1' },
        { email: 'b@x.com', userId: 'u2' },
      ],
      orgId: 'org1',
      orgName: 'Acme',
      sections,
      moreCount: 0,
    })
    expect(res).toEqual({ sent: true })
    // one message per recipient — NOT one per source (which would be 6 sends)
    expect(send).toHaveBeenCalledTimes(2)
    for (const call of send.mock.calls) {
      const msg = call[0] as { html: string; text: string }
      for (const s of sections) {
        expect(msg.html).toContain(s.name)
        expect(msg.html).toContain(s.summary)
        expect(msg.text).toContain(s.name)
        expect(msg.text).toContain(s.summary)
      }
    }
  })

  it('refuses to send an empty digest', async () => {
    const res = await sendDigestEmail({
      to: [{ email: 'a@x.com', userId: 'u1' }],
      orgId: 'o',
      orgName: 'Acme',
      sections: [],
      moreCount: 0,
    })
    expect(res).toEqual({ sent: false, reason: 'no_sections' })
    expect(send).not.toHaveBeenCalled()
  })

  it('no recipients → no send, never throws', async () => {
    const res = await sendDigestEmail({ to: [], orgId: 'o', orgName: 'Acme', sections, moreCount: 0 })
    expect(res).toEqual({ sent: false, reason: 'no_recipients' })
    expect(send).not.toHaveBeenCalled()
  })
})
