import { describe, expect, it } from 'vitest'
import { oauthFeedbackPhase, oauthReturnContext, parseOAuthSnapshot } from './return-feedback'

const id = '00000000-0000-4000-8000-000000000001'
const context = oauthReturnContext(new URLSearchParams({ recovery: 'authorized', supabaseConnection: id }))!
describe('server-confirmed OAuth return feedback', () => {
  it('does not treat a URL success flag as stored success', () => {
    expect(oauthFeedbackPhase(context, null)).toBe('unconfirmed')
    expect(oauthReturnContext(new URLSearchParams('recovery=authorized'))?.connectionId).toBeNull()
    expect(oauthReturnContext(new URLSearchParams('supabaseConnection=private-text'))).toBeNull()
    expect(oauthReturnContext(new URLSearchParams('recovery=private-error'))).toBeNull()
  })
  it('distinguishes saved authorization from data access verification', () => {
    expect(oauthFeedbackPhase(context, { status: 'active', activeSources: 4 })).toBe('authorized')
    expect(oauthFeedbackPhase(context, { status: 'revoked', activeSources: 4 })).toBe('unavailable')
    expect(oauthFeedbackPhase(context, { status: 'pending', activeSources: 4 })).toBe('pending')
  })
  it('keeps provisioning pending until a stored source appears', () => {
    const importing = { ...context, recovery: null, importing: true }
    expect(oauthFeedbackPhase(importing, { status: 'active', activeSources: 0 })).toBe('importing')
    expect(oauthFeedbackPhase(importing, { status: 'active', activeSources: 1 })).toBe('connected')
    expect(oauthFeedbackPhase({ ...importing, selecting: true }, { status: 'active', activeSources: 0 })).toBe('select')
  })
  it.each([null, {}, { status: 'unknown', activeSources: 1 }, { status: 'active', activeSources: -1 }, { status: 'active', activeSources: NaN }, { status: 'active', activeSources: '1' }])('rejects malformed metadata', value => expect(parseOAuthSnapshot(value)).toBeNull())
  it('drops unrelated fields', () => expect(parseOAuthSnapshot({ status: 'active', activeSources: 1, private: 'sample' })).toEqual({ status: 'active', activeSources: 1 }))
})
