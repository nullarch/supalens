import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestWizardExtraction } from './wizard-extraction-request'
import { classifyKpiStart } from '@/app/app/sources/kpi-start-result'

vi.mock('@/utils/analytics', () => ({ track: vi.fn() }))
afterEach(() => vi.unstubAllGlobals())

describe('actual wizard extraction HTTP adapter with local fetch', () => {
  it('keeps the exact source-scoped POST and requires the API acknowledgement', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, extractionId: 'local-id', tier: 2 }) })
    vi.stubGlobal('fetch', fetch)
    const response = await requestWizardExtraction('source/한 글')
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('/api/data-sources/source%2F%ED%95%9C%20%EA%B8%80/kpis/extract', { method: 'POST' })
    expect(classifyKpiStart(response.status, response.body).kind).toBe('accepted')
  })
  for (const [status, body, kind] of [
    [200, {}, 'unknown'], [409, { error: 'extraction_in_progress' }, 'running'],
    [409, { error: 'repo_invalid' }, 'rejected'], [402, { error: 'quota_exceeded' }, 'quota'],
    [503, { error: 'trigger_required' }, 'rejected'], [502, {}, 'unknown'],
  ] as const) it(`preserves ${status}/${kind} for the shared classifier`, async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body }))
    const response = await requestWizardExtraction('local-source')
    expect(classifyKpiStart(response.status, response.body).kind).toBe(kind)
  })
  it('does not turn malformed JSON into an acknowledged start', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('local JSON failure') } }))
    const response = await requestWizardExtraction('local-source')
    expect(classifyKpiStart(response.status, response.body).kind).toBe('unknown')
  })
  it('lets the controller classify transport failure as unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('local transport failure')))
    await expect(requestWizardExtraction('local-source')).rejects.toThrow('local transport failure')
  })
})
