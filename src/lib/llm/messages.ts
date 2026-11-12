// The message shapes every agent loop yields and every runner reads. They are the subset of the
// Claude Agent SDK's stream the runners already consumed (run-analysis.ts and its siblings), so a
// new provider only has to produce these three.

/** A text fragment of the answer, as it is generated. */
export interface StreamEventMessage {
  type: 'stream_event'
  event: { type: 'content_block_delta'; delta: { text: string } }
}

/** One completed model turn: its tool calls (the runner shows them as progress) and token usage. */
export interface AssistantMessage {
  type: 'assistant'
  message: {
    content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; name: string; input: unknown }>
    usage: { input_tokens: number; output_tokens: number }
  }
}

/** The end of the run. `subtype: 'success'` carries the final answer in `result`. */
export interface ResultMessage {
  type: 'result'
  is_error: boolean
  subtype: 'success' | 'error_max_turns' | 'error_during_execution'
  result?: string
  num_turns: number
  total_cost_usd: number
}

export type AgentMessage = StreamEventMessage | AssistantMessage | ResultMessage

/** What a tool handler returns (the Agent SDK's MCP tool result shape). */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** A tool as the provider-neutral loops see it. `shape` is a zod raw shape. */
export interface LocalTool {
  name: string
  description: string
  shape: Record<string, unknown>
  handler: (input: never) => Promise<ToolResult>
}

/** A named group of tools. Tools are exposed to the model as `mcp__<server key>__<tool name>`,
 *  the same naming the Agent SDK uses, so allow-lists and stream consumers are shared. */
export interface LocalToolServer {
  __local: true
  name: string
  instructions?: string
  tools: LocalTool[]
}

/** An agent run: an async stream of messages that can be interrupted. */
export interface AgentQuery extends AsyncIterable<AgentMessage> {
  interrupt(): Promise<void>
}
