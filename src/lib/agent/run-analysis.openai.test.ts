import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The SQL analysis runner end to end on the openai-compatible provider: the same runner, the same
// tools and the same chunk stream as the Claude path, with only the model endpoint faked.
vi.mock('@/lib/query', () => ({
  executeReadOnly: vi.fn(async () => ({ columns: ['day', 'revenue'], rows: [{ day: '2026-11-10', revenue: 1200 }], rowCount: 1, truncated: false })),
  getSchema: vi.fn(async () => ({ tables: [{ schema: 'public', name: 'orders', columns: [{ name: 'id' }, { name: 'total' }] }] })),
  rlsSchemaNote: () => '',
}))
vi.mock('@/lib/context/service', () => ({ getSourceContext: vi.fn(async () => null), renderSourceContextSection: () => '' }))

const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
const call = (id: string, name: string, args: unknown) =>
  sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] }, { choices: [], usage: { prompt_tokens: 200, completion_tokens: 30 } }])

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('LLM_PROVIDER', 'openai')
  vi.stubEnv('LLM_BASE_URL', 'http://llm.local/v1')
  vi.stubEnv('LLM_MODEL', 'local-model')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('runAnalysis on an OpenAI-compatible provider', () => {
  it('runs schema → query → answer and yields the usual chunks and a chart', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(call('c1', 'mcp__supalens__get_schema', {}))
      .mockResolvedValueOnce(call('c2', 'mcp__supalens__execute_sql', { sql: 'select day, sum(total) revenue from orders group by 1' }))
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'Revenue was ' } }] }, { choices: [{ delta: { content: '1,200 on 10 Nov.' } }] }, { choices: [], usage: { prompt_tokens: 400, completion_tokens: 12 } }]))
    vi.stubGlobal('fetch', fetchMock)

    const { runAnalysis } = await import('./run-analysis')
    const chunks: { type: string }[] = []
    const result = await runAnalysis({
      orgId: 'org-1', dataSourceId: 'source-1', userId: 'user-1', runId: 'run-openai-test',
      question: 'What was revenue?', emit: (c) => void chunks.push(c),
    })

    expect(result).toMatchObject({ ok: true, text: 'Revenue was 1,200 on 10 Nov.', turns: 3, tokensIn: 800, tokensOut: 72, costUsd: 0 })
    // no chart was proposed, so the runner synthesises the default table from the last query
    expect(result.visualizations).toHaveLength(1)
    expect(chunks.map((c) => c.type)).toEqual(['tool_use', 'tool_use', 'text', 'text', 'visualization', 'status'])

    // the request went to the configured endpoint with the configured model and exactly the
    // read-only tool set — no key is sent to a server that was not given one
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://llm.local/v1/chat/completions')
    expect(init.headers.Authorization).toBeUndefined()
    const body = JSON.parse(init.body)
    expect(body.model).toBe('local-model')
    expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      'mcp__supalens__execute_sql', 'mcp__supalens__get_schema', 'mcp__supalens__propose_visualization',
    ])
    // every tool schema is a JSON-Schema object the endpoint can accept
    for (const t of body.tools) expect(t.function.parameters.type).toBe('object')
  })

  it('reports a provider failure as a failed run instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })))
    const { runAnalysis } = await import('./run-analysis')
    const result = await runAnalysis({ orgId: 'o', dataSourceId: 's', userId: 'u', runId: 'run-openai-fail', question: 'q' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('model provider returned 401')
  })
})
