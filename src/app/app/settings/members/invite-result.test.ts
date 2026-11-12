import { describe, expect, it } from 'vitest'
import { inviteResult } from './invite-result'

describe('invitation response presentation', () => {
  const data = { token: 'sample', emailSent: false, link: 'https://supalens.example/app/invite/sample' }
  it('keeps invitation creation distinct from email provider acceptance', () => {
    expect(inviteResult({ ok: true, data })).toEqual({ emailSent: false, link: data.link })
    expect(inviteResult({ ok: true, data: { ...data, emailSent: true } })?.emailSent).toBe(true)
  })
  it('rejects invalid, missing or unsuccessful invitation responses', () => {
    for (const value of [null, {}, { ok: false, data }, { ok: true }, { ok: true, data: { ...data, token: '' } }, { ok: true, data: { ...data, emailSent: 'true' } }]) expect(inviteResult(value)).toBeNull()
  })
  it('does not display a malformed or non-HTTP invitation link', () => {
    for (const link of ['', 'javascript:alert(1)', 'file:///app/invite/sample', 'https://example.com/', 'https://example.com/app/invite/']) expect(inviteResult({ ok: true, data: { ...data, link } })).toBeNull()
  })
})
