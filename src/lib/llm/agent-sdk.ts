// NOTE: intentionally NOT `import 'server-only'` — imported by the runners and tool modules,
// which also run in the Trigger.dev runtime.
//
// The one place the agents meet a model provider. It exposes the three functions the runners and
// tool modules use — `tool`, `createSdkMcpServer`, `query` — with the Claude Agent SDK's
// signatures, and routes them by LLM_PROVIDER:
//
//   anthropic → the real Claude Agent SDK, untouched (subprocess lockdown and all).
//   openai    → in-process tool definitions and the OpenAI-compatible loop (./openai-loop.ts).
//
// Runners and tools import from HERE, never from '@anthropic-ai/claude-agent-sdk' directly
// (pinned by src/lib/llm/llm.test.ts), which is what makes the provider a configuration choice.
import * as claude from '@anthropic-ai/claude-agent-sdk'

import type { AgentQuery, LocalTool, LocalToolServer } from './messages'
import { runOpenAiLoop } from './openai-loop'
import { llmProvider, openAiCompatibleConfig } from './provider'

/** Define one tool: name, description, a zod raw shape for its input, and the handler. */
export const tool: typeof claude.tool = ((name: string, description: string, shape: Record<string, unknown>, handler: LocalTool['handler']) => {
  if (llmProvider() === 'anthropic') return (claude.tool as unknown as (...args: unknown[]) => unknown)(name, description, shape, handler)
  return { name, description, shape, handler } satisfies LocalTool
}) as unknown as typeof claude.tool

/** Group tools into a named server (the key it is mounted under becomes the tool-name prefix). */
export const createSdkMcpServer: typeof claude.createSdkMcpServer = ((options: { name: string; instructions?: string; tools?: unknown[] }) => {
  if (llmProvider() === 'anthropic') return claude.createSdkMcpServer(options as Parameters<typeof claude.createSdkMcpServer>[0])
  return { __local: true, name: options.name, instructions: options.instructions, tools: (options.tools ?? []) as LocalTool[] } satisfies LocalToolServer
}) as unknown as typeof claude.createSdkMcpServer

type ClaudeQueryParams = Parameters<typeof claude.query>[0]

/**
 * Start an agent run. Same call shape as the Agent SDK's `query`; the runners read the same
 * three message types from either provider.
 *
 * The openai path uses: prompt (a string), options.model, systemPrompt, mcpServers,
 * allowedTools, maxTurns and abortController. The remaining options are subprocess lockdown
 * settings that have no counterpart there — see the security note in ./openai-loop.ts.
 */
export function query(params: ClaudeQueryParams): AgentQuery {
  if (llmProvider() === 'anthropic') return claude.query(params) as unknown as AgentQuery

  const options = (params.options ?? {}) as {
    model?: string
    systemPrompt?: unknown
    mcpServers?: Record<string, unknown>
    allowedTools?: string[]
    maxTurns?: number
    abortController?: AbortController
  }
  if (typeof params.prompt !== 'string') throw new Error('the openai provider needs a string prompt')
  const servers: Record<string, LocalToolServer> = {}
  for (const [key, server] of Object.entries(options.mcpServers ?? {})) {
    if (server && typeof server === 'object' && (server as { __local?: boolean }).__local) servers[key] = server as LocalToolServer
  }
  return runOpenAiLoop({
    model: options.model ?? '',
    systemPrompt: typeof options.systemPrompt === 'string' ? options.systemPrompt : '',
    prompt: params.prompt,
    servers,
    allowedTools: options.allowedTools ?? [],
    maxTurns: options.maxTurns ?? 25,
    config: openAiCompatibleConfig(),
    signal: options.abortController?.signal,
  })
}
