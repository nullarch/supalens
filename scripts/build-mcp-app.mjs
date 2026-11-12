// Build the MCP App view (src/mcp-app/result-view.ts + .css) into ONE self-contained HTML file,
// .mcp/result-view.html.
//
// MCP Apps hosts render the view in a sandboxed iframe with no network by default, so the script
// and the styles are inlined: the file has no external references at all. The MCP route reads it
// once and serves it as the ui://supalens/result.html resource; `outputFileTracingIncludes` in
// next.config.ts carries it into the built server.
//
// Runs before `npm run build` and `npm run dev` (the pre* scripts in package.json).
//
//   node scripts/build-mcp-app.mjs                      → .mcp/result-view.html
//   node scripts/build-mcp-app.mjs --preview <file.json> [--theme dark] [--out <file.html>]
//       a standalone page that draws the given tool result without a host, for looking at the
//       view in a browser (the JSON is a tool result: {structuredContent: …} or {isError, content}).

import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const preview = flag('--preview')
const outfile = resolve(flag('--out') ?? join(root, '.mcp', preview ? 'result-view.preview.html' : 'result-view.html'))

const result = await build({
  entryPoints: [join(root, 'src/mcp-app/result-view.ts')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  logLevel: 'error',
  alias: { '@': join(root, 'src') },
})

// An inline script ends at the first "</script" whatever the JS means by it.
const inline = (text) => text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')
const js = inline(result.outputFiles[0].text)
const css = readFileSync(join(root, 'src/mcp-app/result-view.css'), 'utf8').replace(/<\/(style)/gi, '<\\/$1')
const theme = flag('--theme')
const seed = preview
  ? `<script>window.__SUPALENS_RESULT_PREVIEW__=${inline(JSON.stringify(JSON.parse(readFileSync(resolve(preview), 'utf8'))))}</script>`
  : ''

const html = `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme === 'dark' ? 'dark' : 'light'}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supalens result</title>
<style>${css}</style>
</head>
<body>
<div id="root" aria-live="polite"></div>
${seed}<script type="module">${js}</script>
</body>
</html>
`

mkdirSync(dirname(outfile), { recursive: true })
writeFileSync(outfile, html)
console.log(`result view bundled → ${outfile} (${(html.length / 1024).toFixed(1)} KB)`)
