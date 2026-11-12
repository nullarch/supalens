import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Drives the REAL protocol handler (mcp-handler + @modelcontextprotocol/server) through the route,
 * with only the credential check and the data layer mocked. Pins what a client depends on:
 * both protocol generations answer from one endpoint, a missing credential starts sign-in instead
 * of reporting an expired one, and a tool result carries the same document as text and as
 * structuredContent.
 */
const verifyMcpToken = vi.fn()
vi.mock('@/lib/mcp/auth', () => ({
  verifyMcpToken: (...args: unknown[]) => verifyMcpToken(...args),
  assertMcpWriteAllowed: vi.fn(),
}))

const rows = [{ id: 'ds1', name: 'Main', engine: 'postgres', status: 'active', last_connected_at: null }]
vi.mock('@/utils/supabase/admin', () => {
  const chain = () => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'limit', 'order', 'in']) q[m] = () => q
    q.then = (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null })
    return q
  }
  return { requireAdminClient: () => ({ from: () => chain() }) }
})

const { POST, GET } = await import('./route')

const ctx = (transport = 'mcp') => ({ params: Promise.resolve({ transport }) })
const AUTH = {
  token: 'sl_test',
  clientId: 'key1',
  scopes: ['read', 'write'],
  extra: { orgId: 'org1', apiKeyId: 'key1', createdBy: 'u1', role: 'owner', scopes: ['read', 'write'] },
}

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'route-test', version: '0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

let id = 1
function modern(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return new Request('https://app.test/api/mcp/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer sl_test',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(method === 'tools/call' ? { 'mcp-name': String(params.name) } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: { ...params, _meta: MODERN_META } }),
  })
}

async function rpcResult(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  const data = text.match(/^data: (.*)$/m)?.[1] ?? text
  const message = JSON.parse(data) as { result?: Record<string, unknown>; error?: unknown }
  if (!message.result) throw new Error(`no result: ${data.slice(0, 300)}`)
  return message.result
}

beforeEach(() => {
  verifyMcpToken.mockReset()
  verifyMcpToken.mockResolvedValue(AUTH)
})

describe('MCP endpoint', () => {
  it('answers the 2026-07-28 protocol without a session: server/discover, then tools/list', async () => {
    const discover = await POST(modern('server/discover'), ctx())
    expect(discover.status).toBe(200)
    const info = await rpcResult(discover)
    expect(JSON.stringify(info)).toContain('supalens')

    const list = await rpcResult(await POST(modern('tools/list'), ctx()))
    const tools = list.tools as { name: string; title?: string; outputSchema?: unknown; annotations?: Record<string, unknown> }[]
    expect(tools).toHaveLength(22)
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy()
      expect(tool.outputSchema, tool.name).toBeTruthy()
      expect(tool.annotations?.title, tool.name).toBe(tool.title)
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe('boolean')
      expect(typeof tool.annotations?.destructiveHint, tool.name).toBe('boolean')
    }
    // the cache hint a 2026-07-28 client uses to skip refetching the list every conversation
    expect(list.ttlMs).toBe(3_600_000)
    expect(list.cacheScope).toBe('private')
  })

  it('still answers a 2025-era client that opens with initialize', async () => {
    const res = await POST(
      new Request('https://app.test/api/mcp/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer sl_test',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'old', version: '0' } },
        }),
      }),
      ctx(),
    )
    expect(res.status).toBe(200)
    const result = await rpcResult(res)
    expect((result.serverInfo as { name: string }).name).toBe('supalens')
  })

  it('a tool answers with the same document as text and as structuredContent', async () => {
    const result = await rpcResult(await POST(modern('tools/call', { name: 'list_data_sources', arguments: {} }), ctx()))
    expect(result.isError).toBeFalsy()
    const text = (result.content as { text: string }[])[0].text
    expect(result.structuredContent).toEqual(JSON.parse(text))
    expect(result.structuredContent).toEqual({ dataSources: rows })
  })

  it('no credential → 401 that starts sign-in, with no error code', async () => {
    const req = modern('tools/list')
    req.headers.delete('authorization')
    const res = await POST(req, ctx())
    expect(res.status).toBe(401)
    const challenge = res.headers.get('www-authenticate') ?? ''
    expect(challenge).toContain('resource_metadata="https://app.test/.well-known/oauth-protected-resource/api/mcp/mcp"')
    expect(challenge).not.toContain('error=')
    expect(verifyMcpToken).not.toHaveBeenCalled()
  })

  it('a credential that fails → 401 invalid_token, never an anonymous downgrade', async () => {
    verifyMcpToken.mockResolvedValue(undefined)
    const res = await POST(modern('tools/list'), ctx())
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })

  it('a browser GET goes to the setup page; the removed transports are gone', async () => {
    const browser = await GET(new Request('https://app.test/api/mcp/mcp', { headers: { accept: 'text/html' } }), ctx())
    expect(browser.status).toBe(302)
    expect((await POST(modern('tools/list'), ctx('sse'))).status).toBe(404)
  })
})
