import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { _resetResultView, registerResultView, RESULT_VIEW_TOOLS, RESULT_VIEW_URI, resultViewAvailable, resultViewToolMeta } from './result-view'
import { registerSupalensTools } from './tools'

/**
 * The inline result view is optional by construction: it is offered only when its built file
 * exists, and only on the tools whose answers it can draw. A server must never advertise a
 * ui:// resource it cannot serve, and must never attach the view to a tool that changes data.
 */
function inDir(withView: boolean): void {
  const dir = mkdtempSync(join(tmpdir(), 'supalens-view-'))
  if (withView) {
    mkdirSync(join(dir, '.mcp'))
    writeFileSync(join(dir, '.mcp', 'result-view.html'), '<!doctype html><title>view</title>')
  }
  vi.spyOn(process, 'cwd').mockReturnValue(dir)
  _resetResultView()
}

interface Registered {
  tools: Map<string, { _meta?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean } }>
  resources: { uri: string; read: (uri: URL) => Promise<{ contents: { mimeType?: string; text?: string }[] }> }[]
}
function register(): Registered {
  const out: Registered = { tools: new Map(), resources: [] }
  const server = {
    registerTool: (name: string, config: Registered['tools'] extends Map<string, infer C> ? C : never) => out.tools.set(name, config),
    registerResource: (_name: string, uri: string, _config: unknown, read: Registered['resources'][number]['read']) =>
      out.resources.push({ uri, read }),
  } as unknown as McpServer
  registerSupalensTools(server)
  registerResultView(server)
  return out
}

afterEach(() => {
  vi.restoreAllMocks()
  _resetResultView()
})

describe('result view', () => {
  it('is not offered when the view has not been built', () => {
    inDir(false)
    expect(resultViewAvailable()).toBe(false)
    expect(resultViewToolMeta()).toEqual({})
    const { tools, resources } = register()
    expect(resources).toEqual([])
    for (const [name, config] of tools) expect(config._meta, name).toBeUndefined()
  })

  it('is linked from the data tools only, and all of them are read-only', () => {
    inDir(true)
    const { tools } = register()
    const linked = [...tools].filter(([, c]) => c._meta).map(([name]) => name)
    expect(linked.sort()).toEqual([...RESULT_VIEW_TOOLS].sort())
    for (const name of linked) {
      const config = tools.get(name)
      expect((config?._meta?.ui as { resourceUri: string }).resourceUri).toBe(RESULT_VIEW_URI)
      expect(config?._meta?.['ui/resourceUri']).toBe(RESULT_VIEW_URI)
      expect(config?.annotations?.readOnlyHint, name).toBe(true)
    }
  })

  it('serves the built file as an MCP App resource', async () => {
    inDir(true)
    const { resources } = register()
    expect(resources.map((r) => r.uri)).toEqual([RESULT_VIEW_URI])
    const { contents } = await resources[0].read(new URL(RESULT_VIEW_URI))
    expect(contents[0].mimeType).toBe('text/html;profile=mcp-app')
    expect(contents[0].text).toContain('<title>view</title>')
  })
})
