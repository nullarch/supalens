import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { AgentMessage, LocalToolServer } from './messages'
import { runOpenAiLoop, toolFullName, toolParameters } from './openai-loop'
import { llmConfigured, llmProvider, openAiCompatibleConfig, resolveModels } from './provider'

const config = { baseUrl: 'https://llm.example.com/v1', apiKey: 'sk-test', headers: {} }

/** A streamed completion: text fragments, then tool calls split across chunks, then usage. */
function sse(parts: { text?: string[]; calls?: Array<{ id: string; name: string; args: string }>; usage?: [number, number] }): Response {
  const lines: string[] = []
  for (const t of parts.text ?? []) lines.push(JSON.stringify({ choices: [{ delta: { content: t } }] }))
  ;(parts.calls ?? []).forEach((call, index) => {
    const half = Math.ceil(call.args.length / 2)
    lines.push(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, id: call.id, function: { name: call.name, arguments: call.args.slice(0, half) } }] } }] }))
    lines.push(JSON.stringify({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: call.args.slice(half) } }] } }] }))
  })
  const [input, output] = parts.usage ?? [10, 5]
  lines.push(JSON.stringify({ choices: [], usage: { prompt_tokens: input, completion_tokens: output } }))
  const body = lines.map((l) => `data: ${l}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function server(handlers: { sql?: (input: { sql: string }) => Promise<string> } = {}): LocalToolServer {
  return {
    __local: true,
    name: 'supalens',
    tools: [
      {
        name: 'execute_sql',
        description: 'Run a read-only query.',
        shape: { sql: z.string() },
        handler: (async (input: { sql: string }) => ({
          content: [{ type: 'text' as const, text: await (handlers.sql ?? (async () => '{"rows":[{"n":3}]}'))(input) }],
        })) as never,
      },
      {
        name: 'drop_everything',
        description: 'Registered but never allowed.',
        shape: {},
        handler: (async () => ({ content: [{ type: 'text' as const, text: 'should never run' }] })) as never,
      },
    ],
  }
}

async function collect(q: AsyncIterable<AgentMessage>): Promise<AgentMessage[]> {
  const out: AgentMessage[] = []
  for await (const m of q) out.push(m)
  return out
}

const SQL = toolFullName('supalens', 'execute_sql')
const base = { model: 'gpt-test', systemPrompt: 'You analyse data.', prompt: 'How many orders?', allowedTools: [SQL], maxTurns: 5, config }

describe('provider config', () => {
  it('defaults to anthropic and recognises the openai-compatible spellings', () => {
    expect(llmProvider({})).toBe('anthropic')
    expect(llmProvider({ LLM_PROVIDER: 'OpenAI' })).toBe('openai')
    expect(llmProvider({ LLM_PROVIDER: 'openai-compatible' })).toBe('openai')
    expect(llmProvider({ LLM_PROVIDER: 'something-else' })).toBe('anthropic')
  })

  it('resolves model tiers per provider', () => {
    expect(resolveModels({})).toEqual({ analysis: 'claude-sonnet-5', system: 'claude-haiku-4-5-20251001' })
    expect(resolveModels({ LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-x' })).toEqual({ analysis: 'gpt-x', system: 'gpt-x' })
    expect(resolveModels({ LLM_PROVIDER: 'openai', LLM_MODEL: 'big', LLM_MODEL_SMALL: 'small' })).toEqual({ analysis: 'big', system: 'small' })
    // never a Claude default on someone else's endpoint
    expect(resolveModels({ LLM_PROVIDER: 'openai' })).toEqual({ analysis: '', system: '' })
  })

  it('knows whether a provider is usable', () => {
    expect(llmConfigured({})).toBe(false)
    expect(llmConfigured({ ANTHROPIC_API_KEY: 'sk-ant' })).toBe(true)
    expect(llmConfigured({ LLM_PROVIDER: 'openai' })).toBe(false)
    // a local server needs a model name but no key
    expect(llmConfigured({ LLM_PROVIDER: 'openai', LLM_MODEL: 'llama3.1' })).toBe(true)
  })

  it('reads the endpoint, key and extra headers', () => {
    expect(openAiCompatibleConfig({})).toEqual({ baseUrl: 'https://api.openai.com/v1', apiKey: '', headers: {} })
    expect(openAiCompatibleConfig({ LLM_BASE_URL: 'http://ollama:11434/v1/', LLM_HEADERS: '{"X-Title":"Supalens","n":1}' }))
      .toEqual({ baseUrl: 'http://ollama:11434/v1', apiKey: '', headers: { 'X-Title': 'Supalens' } })
    expect(openAiCompatibleConfig({ LLM_HEADERS: 'not json' }).headers).toEqual({})
  })
})

describe('openai-compatible agent loop', () => {
  it('calls a tool, feeds the result back, and finishes with the answer', async () => {
    const ran: string[] = []
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sse({ text: ['Let me check. '], calls: [{ id: 'c1', name: SQL, args: '{"sql":"select count(*) from orders"}' }], usage: [100, 20] }))
      .mockResolvedValueOnce(sse({ text: ['There are ', '3 orders.'], usage: [150, 8] }))
    const messages = await collect(runOpenAiLoop({ ...base, servers: { supalens: server({ sql: async ({ sql }) => (ran.push(sql), '{"rows":[{"n":3}]}') }) }, fetchImpl }))

    expect(ran).toEqual(['select count(*) from orders'])
    expect(messages.filter((m) => m.type === 'stream_event').map((m) => (m.type === 'stream_event' ? m.event.delta.text : ''))).toEqual(['Let me check. ', 'There are ', '3 orders.'])
    const assistants = messages.filter((m) => m.type === 'assistant')
    expect(assistants[0]).toMatchObject({ message: { content: [{ type: 'text' }, { type: 'tool_use', name: SQL, input: { sql: 'select count(*) from orders' } }], usage: { input_tokens: 100, output_tokens: 20 } } })
    expect(messages.at(-1)).toEqual({ type: 'result', is_error: false, subtype: 'success', result: 'There are 3 orders.', num_turns: 2, total_cost_usd: 0 })

    // the second request carries the tool result back, addressed to the call id
    const second = JSON.parse(fetchImpl.mock.calls[1][1].body)
    expect(second.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"rows":[{"n":3}]}' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://llm.example.com/v1/chat/completions')
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test')
  })

  it('offers only allowed tools and refuses a call to anything else', async () => {
    const forbidden = toolFullName('supalens', 'drop_everything')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sse({ calls: [{ id: 'c1', name: forbidden, args: '{}' }] }))
      .mockResolvedValueOnce(sse({ text: ['ok'] }))
    await collect(runOpenAiLoop({ ...base, servers: { supalens: server() }, fetchImpl }))

    const first = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(first.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([SQL])
    const second = JSON.parse(fetchImpl.mock.calls[1][1].body)
    expect(second.messages.at(-1).content).toContain('is not available in this run')
  })

  it('validates tool input before the handler runs, and reports bad JSON', async () => {
    const sql = vi.fn(async () => 'never')
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sse({ calls: [{ id: 'a', name: SQL, args: '{"sql":42}' }, { id: 'b', name: SQL, args: '{not json' }] }))
      .mockResolvedValueOnce(sse({ text: ['done'] }))
    await collect(runOpenAiLoop({ ...base, servers: { supalens: server({ sql }) }, fetchImpl }))
    expect(sql).not.toHaveBeenCalled()
    const [a, b] = JSON.parse(fetchImpl.mock.calls[1][1].body).messages.slice(-2)
    expect(a.content).toContain('invalid arguments')
    expect(b.content).toContain('not valid JSON')
  })

  it('stops at the turn limit with an error result', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => sse({ calls: [{ id: 'c', name: SQL, args: '{"sql":"select 1"}' }] }))
    const messages = await collect(runOpenAiLoop({ ...base, maxTurns: 2, servers: { supalens: server() }, fetchImpl }))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(messages.at(-1)).toMatchObject({ type: 'result', is_error: true, subtype: 'error_max_turns', num_turns: 2 })
  })

  it('surfaces a provider error and a missing model as thrown errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"error":"bad key"}', { status: 401 }))
    await expect(collect(runOpenAiLoop({ ...base, servers: {}, fetchImpl }))).rejects.toThrow('model provider returned 401')
    await expect(collect(runOpenAiLoop({ ...base, model: '', servers: {}, fetchImpl }))).rejects.toThrow('No model is configured')
  })

  it('accepts a non-streamed JSON completion (servers that ignore stream:true)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'plain answer' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const messages = await collect(runOpenAiLoop({ ...base, servers: {}, fetchImpl }))
    expect(messages.at(-1)).toMatchObject({ subtype: 'success', result: 'plain answer' })
  })

  it('turns a zod shape into function parameters', () => {
    expect(toolParameters({ sql: z.string().describe('A query'), limit: z.number().optional() })).toMatchObject({
      type: 'object',
      properties: { sql: { type: 'string', description: 'A query' }, limit: { type: 'number' } },
      required: ['sql'],
    })
  })
})

describe('provider boundary', () => {
  it('only src/lib/llm/agent-sdk.ts imports the Claude Agent SDK', () => {
    const files = execFileSync('git', ['ls-files', 'src', 'trigger'], { encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))
    const direct = files.filter((f) => /from ['"]@anthropic-ai\/claude-agent-sdk['"]/.test(readFileSync(f, 'utf8')))
    expect(direct).toEqual(['src/lib/llm/agent-sdk.ts'])
  })
})
