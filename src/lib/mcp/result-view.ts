import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/server'
import { RESOURCE_MIME_TYPE, RESOURCE_URI_META_KEY, registerAppResource } from '@modelcontextprotocol/ext-apps/server'

/**
 * The MCP App view for data results: hosts that support MCP Apps (Claude on the web, Desktop and
 * mobile; VS Code; others) draw `ui://supalens/result.html` inline when a data tool answers —
 * the charts an analysis chose, or a chart/table for a bare query result. Every other client
 * keeps the text answer; nothing about the tools' results changes.
 *
 * The view is one pre-built, self-contained HTML file (scripts/build-mcp-app.mjs → .mcp/), read
 * once per server instance. If the file is absent — a checkout that has not run the build step —
 * the view is simply not offered: the tools register without it rather than advertising a
 * resource that cannot be read.
 *
 * It draws only what the host hands it (the tool result the model also reads). It has no network
 * access and declares none, so a result never leaves the conversation through the view.
 */
export const RESULT_VIEW_URI = 'ui://supalens/result.html'

/** The tools whose answers the view knows how to draw (see src/mcp-app/model.ts::figuresFrom). */
export const RESULT_VIEW_TOOLS = ['execute_sql', 'query_documents', 'aggregate', 'get_analysis'] as const

let cached: string | null | undefined
function resultViewHtml(): string | null {
  if (cached === undefined) {
    const file = join(process.cwd(), '.mcp', 'result-view.html')
    cached = existsSync(file) ? readFileSync(file, 'utf8') : null
  }
  return cached
}

export const resultViewAvailable = (): boolean => resultViewHtml() !== null

/**
 * Tool `_meta` that links a tool to the view, or nothing when the view is not built. Both the
 * current key (`ui.resourceUri`) and the flat key older hosts read.
 */
export function resultViewToolMeta(): { _meta?: Record<string, unknown> } {
  if (!resultViewAvailable()) return {}
  return { _meta: { ui: { resourceUri: RESULT_VIEW_URI }, [RESOURCE_URI_META_KEY]: RESULT_VIEW_URI } }
}

/** Register the view resource. No `csp` domains and no `domain`: the view never fetches. */
export function registerResultView(server: McpServer): void {
  const html = resultViewHtml()
  if (html === null) return
  registerAppResource(
    server,
    'result-view',
    RESULT_VIEW_URI,
    {
      title: 'Result view',
      description: 'Charts and tables for a Supalens query or analysis result.',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: { prefersBorder: false } } }],
    }),
  )
}

/** Test seam: forget the cached file state. */
export function _resetResultView(): void {
  cached = undefined
}
