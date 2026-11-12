import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), locale: vi.fn(), render: vi.fn() }))
vi.mock('@/utils/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('next-intl/server', () => ({ getLocale: mocks.locale }))
vi.mock('./image-renderer', () => ({ renderShareImage: mocks.render }))

import Image, { generateImageMetadata } from '@/app/share/[token]/opengraph-image'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.render.mockResolvedValue(Buffer.from('local sample PNG adapter'))
})

describe('actual share-image route with local adapters', () => {
  it.each(['en', 'ko', 'ja'])('keeps exact token-scoped read and %s response language', async id => {
    const limit = vi.fn().mockResolvedValue({ data: [{ question: 'Sample question', result: { text: 'Sample answer' } }] })
    const eq = vi.fn(() => ({ limit }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    mocks.admin.mockReturnValue({ from })
    const response = await Image({ params: Promise.resolve({ token: 'LOCAL-ADAPTER-ONLY' }), id })
    expect(from).toHaveBeenCalledExactlyOnceWith('agent_runs')
    expect(select).toHaveBeenCalledExactlyOnceWith('question, result')
    expect(eq).toHaveBeenCalledExactlyOnceWith('share_token', 'LOCAL-ADAPTER-ONLY')
    expect(limit).toHaveBeenCalledExactlyOnceWith(1)
    expect(mocks.render).toHaveBeenCalledExactlyOnceWith({ locale: id, question: 'Sample question', answer: 'Sample answer' })
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(await response.text()).toBe('local sample PNG adapter')
  })
  it('retains neutral fallback when the existing admin client is unavailable', async () => {
    mocks.admin.mockReturnValue(null)
    await Image({ params: Promise.resolve({ token: 'LOCAL-ADAPTER-ONLY' }), id: 'en' })
    expect(mocks.render).toHaveBeenCalledWith({ locale: 'en', question: undefined, answer: undefined })
  })
  it.each(['en', 'ko', 'ja'])('lists every stable image ID with %s preferred', async locale => {
    mocks.locale.mockResolvedValue(locale)
    const metadata = await generateImageMetadata()
    expect(metadata[0].id).toBe(locale)
    expect(metadata.map(item => item.id).sort()).toEqual(['en', 'ja', 'ko'])
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
