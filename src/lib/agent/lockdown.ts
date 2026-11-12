// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev
// agent runtime, same convention as the runners that import it.

/**
 * The agent-subprocess lockdown, shared VERBATIM by all three runners
 * (agent/run-analysis, code-agent/run-code-analysis, firestore-agent/
 * run-firestore-analysis). This module exists so the security invariants live in
 * ONE place and are directly unit-tested (lockdown.test.ts):
 *
 *   1. buildChildEnv REPLACES the claude subprocess env — DB/KMS/service-role
 *      creds and tenant secrets never reach the model's process. Only
 *      PATH/HOME/ANTHROPIC_API_KEY plus explicitly-listed non-secret
 *      gateway/proxy/TLS vars pass through.
 *   2. makeToolGate is the canUseTool defense-in-depth allow-list: anything not
 *      in the runner's allow-list is denied (the primary gate is allowedTools +
 *      permissionMode 'dontAsk'; this backstops ask/default modes).
 *   3. LOCKDOWN_DISALLOWED_TOOLS pins the built-in tools that must stay banned.
 *
 * Do NOT add secrets to PASSTHROUGH_ENV. Do NOT remove entries from
 * LOCKDOWN_DISALLOWED_TOOLS. The tests pin both.
 */

/** non-secret runtime vars forwarded to the claude subprocess IF present (gateway/proxy/TLS). */
export const PASSTHROUGH_ENV = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'NODE_EXTRA_CA_CERTS',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
] as const

/** built-in harness tools that must never be available to the analysis agents. */
export const LOCKDOWN_DISALLOWED_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Glob', 'Grep'] as const

export function buildChildEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {
    PATH: source.PATH ?? '',
    HOME: source.HOME ?? '/tmp',
    ANTHROPIC_API_KEY: source.ANTHROPIC_API_KEY ?? '',
  }
  for (const k of PASSTHROUGH_ENV) {
    const v = source[k]
    if (v) env[k] = v
  }
  return env
}

export type ToolGateResult =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/** canUseTool factory: allow exactly the runner's tool list, deny everything else. */
export function makeToolGate(allowedTools: readonly string[]) {
  return async (toolName: string, input: Record<string, unknown>): Promise<ToolGateResult> => {
    if (allowedTools.includes(toolName)) return { behavior: 'allow', updatedInput: input }
    return { behavior: 'deny', message: `tool "${toolName}" is not permitted in supalens analysis` }
  }
}
