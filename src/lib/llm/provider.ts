// NOTE: intentionally NOT `import 'server-only'` — read by the runners, which also run in the
// Trigger.dev runtime. Pure env config.
//
// Which model provider runs the agents.
//
//   anthropic — the Claude Agent SDK (the default, and what the hosted service uses). The model
//               runs in a locked-down subprocess; needs ANTHROPIC_API_KEY.
//   openai    — ANY endpoint that speaks the OpenAI Chat Completions API with tool calling:
//               OpenAI, Google Gemini (its OpenAI-compatible endpoint), OpenRouter, Groq,
//               Together, Azure OpenAI, and local servers such as Ollama, vLLM or LM Studio.
//               The agent loop runs in this process (src/lib/llm/openai-loop.ts) with the SAME
//               tools; nothing is spawned.
//
// Adding a provider with a different wire format means one new loop module that yields the
// message shapes in ./messages.ts, plus a branch in ./agent-sdk.ts. The runners, the tools, the
// prompts and the stream consumers do not change.

export type LlmProvider = 'anthropic' | 'openai'

export function llmProvider(env: Record<string, string | undefined> = process.env): LlmProvider {
  const v = env.LLM_PROVIDER?.trim().toLowerCase()
  if (v === 'openai' || v === 'openai-compatible' || v === 'openai_compatible') return 'openai'
  return 'anthropic'
}

export interface OpenAiCompatibleConfig {
  baseUrl: string
  apiKey: string
  /** Extra request headers, e.g. OpenRouter's HTTP-Referer, or Azure's api-key. */
  headers: Record<string, string>
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    )
  } catch {
    return {}
  }
}

/** LLM_BASE_URL (default: OpenAI), LLM_API_KEY (may be empty for a local server), LLM_HEADERS (JSON). */
export function openAiCompatibleConfig(env: Record<string, string | undefined> = process.env): OpenAiCompatibleConfig {
  return {
    baseUrl: (env.LLM_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: env.LLM_API_KEY?.trim() ?? '',
    headers: parseHeaders(env.LLM_HEADERS),
  }
}

/**
 * The two model tiers (see src/lib/agent/models.ts for what each is used for).
 * anthropic: ANALYSIS_MODEL / SYSTEM_RUN_MODEL with Claude defaults.
 * openai:    LLM_MODEL is required (there is no sensible default across providers);
 *            LLM_MODEL_SMALL optionally names a cheaper model for background summaries.
 */
export function resolveModels(env: Record<string, string | undefined> = process.env): { analysis: string; system: string } {
  if (llmProvider(env) === 'openai') {
    const main = env.ANALYSIS_MODEL || env.LLM_MODEL || ''
    return { analysis: main, system: env.SYSTEM_RUN_MODEL || env.LLM_MODEL_SMALL || main }
  }
  return {
    analysis: env.ANALYSIS_MODEL || 'claude-sonnet-5',
    system: env.SYSTEM_RUN_MODEL || 'claude-haiku-4-5-20251001',
  }
}

/** Is a model provider usable at all? UI and routes use this to say "no model configured"
 *  instead of failing a run deep inside the agent. */
export function llmConfigured(env: Record<string, string | undefined> = process.env): boolean {
  if (llmProvider(env) === 'openai') return Boolean(resolveModels(env).analysis)
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)
}
