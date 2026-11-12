// NOTE: intentionally NOT `import 'server-only'` — runs wherever the agents run.
//
// Agent loop for any OpenAI-compatible Chat Completions endpoint with tool calling.
//
// It does what the Claude Agent SDK does for the anthropic provider, in this process: send the
// conversation and the tool definitions, run the tools the model calls, feed the results back,
// and stop at a plain-text answer or the turn limit. It yields the message shapes in
// ./messages.ts, so the runners consume it exactly like the SDK stream.
//
// Security posture, compared with the subprocess lockdown in src/lib/agent/lockdown.ts:
//   - There is no subprocess and no built-in tool at all. The ONLY things the model can cause to
//     happen are the handlers passed in here, and `allowedTools` filters even those. A tool that
//     is not registered and allowed does not exist for the model — the same structural
//     read-only guarantee, with nothing to deny.
//   - Credentials stay in the handlers' closures. The request to the provider carries the
//     prompts, the tool schemas and the tool results — never a database or vault secret.
//   - Tool input is validated against the tool's zod shape before the handler runs.
import { z } from 'zod'

import type { AgentMessage, AgentQuery, LocalTool, LocalToolServer, ToolResult } from './messages'
import type { OpenAiCompatibleConfig } from './provider'

export interface OpenAiLoopOptions {
  model: string
  systemPrompt: string
  prompt: string
  servers: Record<string, LocalToolServer>
  /** Full tool names (`mcp__<server>__<tool>`) the run may use. Anything else is not offered. */
  allowedTools: readonly string[]
  maxTurns: number
  config: OpenAiCompatibleConfig
  signal?: AbortSignal
  /** Injected in tests. */
  fetchImpl?: typeof fetch
}

interface ChatToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface Turn {
  text: string
  toolCalls: ChatToolCall[]
  inputTokens: number
  outputTokens: number
}

/** One model tool result is capped so a huge query result cannot blow the context window. */
const MAX_TOOL_RESULT_CHARS = 60_000

export function toolFullName(serverKey: string, toolName: string): string {
  return `mcp__${serverKey}__${toolName}`
}

/** JSON Schema for a tool's zod shape, in the form function-calling endpoints accept. */
export function toolParameters(shape: Record<string, unknown>): Record<string, unknown> {
  const schema = z.toJSONSchema(z.object(shape as z.ZodRawShape), { unrepresentable: 'any' }) as Record<string, unknown>
  delete schema.$schema
  return schema
}

function resultText(result: ToolResult): string {
  const text = result.content.map((c) => c.text).join('\n')
  const capped = text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n…[truncated]` : text
  return result.isError ? `ERROR: ${capped}` : capped
}

async function runTool(tool: LocalTool | undefined, name: string, rawArguments: string): Promise<{ input: unknown; output: string }> {
  if (!tool) return { input: {}, output: `ERROR: tool "${name}" is not available in this run.` }
  let parsed: unknown
  try {
    parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {}
  } catch {
    return { input: rawArguments, output: 'ERROR: the tool arguments were not valid JSON. Call the tool again with a JSON object.' }
  }
  const checked = z.object(tool.shape as z.ZodRawShape).safeParse(parsed)
  if (!checked.success) {
    const issues = checked.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
    return { input: parsed, output: `ERROR: invalid arguments — ${issues}` }
  }
  try {
    return { input: checked.data, output: resultText(await tool.handler(checked.data as never)) }
  } catch (error) {
    return { input: checked.data, output: `ERROR: ${String(error instanceof Error ? error.message : error).slice(0, 500)}` }
  }
}

/** Read one streamed (SSE) or plain JSON completion, yielding text deltas as they arrive. */
async function* readCompletion(response: Response, turn: Turn): AsyncGenerator<string> {
  const calls = new Map<number, ChatToolCall>()
  const absorb = (choice: Record<string, unknown> | undefined, usage: Record<string, number> | undefined): string => {
    if (usage) {
      turn.inputTokens = usage.prompt_tokens ?? turn.inputTokens
      turn.outputTokens = usage.completion_tokens ?? turn.outputTokens
    }
    const delta = (choice?.delta ?? choice?.message) as
      | { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }
      | undefined
    for (const part of delta?.tool_calls ?? []) {
      const index = part.index ?? calls.size
      const call = calls.get(index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
      if (part.id) call.id = part.id
      if (part.function?.name) call.function.name += part.function.name
      if (part.function?.arguments) call.function.arguments += part.function.arguments
      calls.set(index, call)
    }
    return typeof delta?.content === 'string' ? delta.content : ''
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream') || !response.body) {
    const body = (await response.json()) as { choices?: Array<Record<string, unknown>>; usage?: Record<string, number> }
    const text = absorb(body.choices?.[0], body.usage)
    if (text) {
      turn.text += text
      yield text
    }
  } else {
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        let chunk: { choices?: Array<Record<string, unknown>>; usage?: Record<string, number> }
        try {
          chunk = JSON.parse(data)
        } catch {
          continue // a keep-alive or a partial line some servers emit
        }
        const text = absorb(chunk.choices?.[0], chunk.usage)
        if (text) {
          turn.text += text
          yield text
        }
      }
    }
  }
  turn.toolCalls = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
    .filter((call) => call.function.name)
}

export function runOpenAiLoop(options: OpenAiLoopOptions): AgentQuery {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) abort()
    else options.signal.addEventListener('abort', abort, { once: true })
  }
  const doFetch = options.fetchImpl ?? fetch

  // Only registered AND allowed tools exist for the model.
  const tools = new Map<string, LocalTool>()
  for (const [serverKey, server] of Object.entries(options.servers)) {
    for (const tool of server.tools) {
      const name = toolFullName(serverKey, tool.name)
      if (options.allowedTools.includes(name)) tools.set(name, tool)
    }
  }
  const toolDefinitions = [...tools.entries()].map(([name, tool]) => ({
    type: 'function' as const,
    function: { name, description: tool.description, parameters: toolParameters(tool.shape) },
  }))

  async function* run(): AsyncGenerator<AgentMessage> {
    if (!options.model) {
      throw new Error('No model is configured. Set LLM_MODEL (and LLM_BASE_URL / LLM_API_KEY) for the openai provider.')
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.prompt },
    ]
    let turns = 0
    let lastText = ''

    while (turns < options.maxTurns) {
      turns++
      const response = await doFetch(`${options.config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.config.apiKey ? { Authorization: `Bearer ${options.config.apiKey}` } : {}),
          ...options.config.headers,
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          ...(toolDefinitions.length > 0 ? { tools: toolDefinitions, tool_choice: 'auto' } : {}),
          stream: true,
          stream_options: { include_usage: true },
        }),
      })
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300)
        throw new Error(`model provider returned ${response.status}${detail ? `: ${detail}` : ''}`)
      }

      const turn: Turn = { text: '', toolCalls: [], inputTokens: 0, outputTokens: 0 }
      for await (const text of readCompletion(response, turn)) {
        yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } }
      }
      lastText = turn.text || lastText

      const executed: Array<{ call: ChatToolCall; input: unknown; output: string }> = []
      for (const call of turn.toolCalls) {
        const { input, output } = await runTool(tools.get(call.function.name), call.function.name, call.function.arguments)
        executed.push({ call, input, output })
      }

      yield {
        type: 'assistant',
        message: {
          content: [
            ...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []),
            ...executed.map((e) => ({ type: 'tool_use' as const, name: e.call.function.name, input: e.input })),
          ],
          usage: { input_tokens: turn.inputTokens, output_tokens: turn.outputTokens },
        },
      }

      if (executed.length === 0) {
        yield { type: 'result', is_error: false, subtype: 'success', result: turn.text, num_turns: turns, total_cost_usd: 0 }
        return
      }
      messages.push({ role: 'assistant', content: turn.text || null, tool_calls: turn.toolCalls })
      for (const e of executed) messages.push({ role: 'tool', tool_call_id: e.call.id, content: e.output })
    }

    yield { type: 'result', is_error: true, subtype: 'error_max_turns', result: lastText, num_turns: turns, total_cost_usd: 0 }
  }

  const iterator = run()
  return {
    [Symbol.asyncIterator]: () => iterator,
    interrupt: async () => abort(),
  }
}
