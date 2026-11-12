import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn((url: string): never => { throw new Error(`LOCAL_REDIRECT:${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))
import AppHome from './page'
import McpRedirect from './mcp/page'
import AlertsRedirect from './alerts/page'
import IncidentsRedirect from './incidents/page'

beforeEach(() => { redirect.mockClear() })
describe('actual redirect-only route contracts', () => {
  it('lands on the operational overview', () => {
    expect(() => AppHome()).toThrow('LOCAL_REDIRECT:/app/overview')
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/app/overview')
  })
  it('keeps the old MCP bookmark usable', () => {
    expect(() => McpRedirect()).toThrow('LOCAL_REDIRECT:/app/settings/developer')
  })
  it('keeps the old alert bookmark usable without an empty query delimiter', async () => {
    await expect(AlertsRedirect({ searchParams: Promise.resolve({ absent: undefined }) })).rejects.toThrow('LOCAL_REDIRECT:/app/monitors')
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/app/monitors')
  })
  // The incident QUEUE became the 감시 screen's second view (/app/monitors?view=incidents); only the
  // list moved, so /app/incidents/[id] — what the email/Slack/Discord links open — is NOT a redirect.
  it('keeps the old incident queue bookmark usable', async () => {
    await expect(IncidentsRedirect({ searchParams: Promise.resolve({}) })).rejects.toThrow('LOCAL_REDIRECT:/app/monitors?view=incidents')
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/app/monitors?view=incidents')
  })
  it('carries a status filter into the merged view, minus the queue default', async () => {
    await expect(IncidentsRedirect({ searchParams: Promise.resolve({ status: 'resolved' }) })).rejects.toThrow('LOCAL_REDIRECT:/app/monitors?view=incidents&status=resolved')
    await expect(IncidentsRedirect({ searchParams: Promise.resolve({ status: 'openish' }) })).rejects.toThrow('LOCAL_REDIRECT:/app/monitors?view=incidents')
  })
  it('preserves repeated filters, empty values, Unicode and escaped edit IDs', async () => {
    const values = { edit: 'sample/one?x=1&y=2', tag: ['서울', '日本語'], empty: '', omitted: undefined }
    await expect(AlertsRedirect({ searchParams: Promise.resolve(values) })).rejects.toThrow('LOCAL_REDIRECT:')
    const url = new URL(redirect.mock.calls[0][0], 'https://local.example.invalid')
    expect(url.pathname).toBe('/app/monitors')
    expect(url.searchParams.get('edit')).toBe(values.edit)
    expect(url.searchParams.getAll('tag')).toEqual(values.tag)
    expect(url.searchParams.get('empty')).toBe('')
    expect(url.searchParams.has('omitted')).toBe(false)
  })
})
