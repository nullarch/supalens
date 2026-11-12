import { describe, expect, it } from 'vitest'

import type { McpServer } from '@modelcontextprotocol/server'

import { registerSupalensTools } from './tools'

/**
 * Pin the connector-directory metadata contract: every MCP tool must declare a `title` and
 * `annotations.readOnlyHint` (Anthropic's submission portal flags and blocks unannotated tools),
 * and the read-only / write partition must change only deliberately — a write tool silently
 * annotated read-only would run WITHOUT per-call user confirmation in Claude.
 */
interface CollectedTool {
  title?: string
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean }
}

function collectTools(): Map<string, CollectedTool> {
  const tools = new Map<string, CollectedTool>()
  const server = {
    registerTool: (name: string, config: CollectedTool) => {
      tools.set(name, config)
    },
  }
  registerSupalensTools(server as unknown as McpServer)
  return tools
}

// `ask` is deliberately read-only: the analysis is strictly read-only over the tenant DB;
// its run record + quota increment are internal bookkeeping (see the comment in tools.ts).
const READ_ONLY_TOOLS = [
  'aggregate',
  'ask',
  'execute_sql',
  'get_analysis',
  'get_collection_schema',
  'get_schema',
  'get_setup_status',
  'list_alerts',
  'list_collections',
  'list_dashboards',
  'list_data_sources',
  'list_kpis',
  'list_widgets',
  'query_documents',
].sort()

const WRITE_TOOLS = [
  'add_widget',
  'apply_kpis',
  'create_alert',
  'create_dashboard',
  'delete_alert',
  'extract_kpis',
  'register_query',
  'toggle_alert',
].sort()

describe('MCP tool annotations (connector-directory contract)', () => {
  const tools = collectTools()

  it('registers the exact pinned tool set', () => {
    expect([...tools.keys()].sort()).toEqual([...READ_ONLY_TOOLS, ...WRITE_TOOLS].sort())
  })

  it('every tool declares a non-empty title and a readOnlyHint', () => {
    for (const [name, config] of tools) {
      expect(config.title, `${name} is missing a title`).toBeTruthy()
      expect(typeof config.annotations?.readOnlyHint, `${name} is missing annotations.readOnlyHint`).toBe('boolean')
    }
  })

  it('read-only vs write partition matches the pin', () => {
    const readOnly = [...tools].filter(([, c]) => c.annotations?.readOnlyHint === true).map(([n]) => n)
    const write = [...tools].filter(([, c]) => c.annotations?.readOnlyHint === false).map(([n]) => n)
    expect(readOnly.sort()).toEqual(READ_ONLY_TOOLS)
    expect(write.sort()).toEqual(WRITE_TOOLS)
  })

  it('every write tool declares destructiveHint', () => {
    for (const name of WRITE_TOOLS) {
      expect(typeof tools.get(name)?.annotations?.destructiveHint, `${name} is missing destructiveHint`).toBe('boolean')
    }
  })

  it('tool names satisfy the directory limit (≤64 chars)', () => {
    for (const name of tools.keys()) expect(name.length).toBeLessThanOrEqual(64)
  })
})
