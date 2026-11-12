/**
 * Run a Business X-ray locally against a PUBLIC GitHub repo — no database, no Trigger.dev.
 * Same code path as trigger/cloud/xray.ts (runCodeAnalysis + the X-ray tools + finalizeReport); prints
 * the live events and writes the verified report JSON. Useful for prompt work and for producing
 * sample reports by hand.
 *
 * Usage (needs ANTHROPIC_API_KEY, plus `git` and `rg` on PATH):
 *   npx tsx --env-file=.env.local scripts/xray-local.ts <owner/repo> [--out report.json] [--locale en]
 */
import { writeFile } from 'fs/promises'

import { runCodeAnalysis } from '@/lib/code-agent/run-code-analysis'
import { cloneInfo } from '@/lib/xray/clone-info'
import { XRAY_MAX_TOTAL_TOKENS, XRAY_MAX_TURNS } from '@/lib/xray/config'
import { xrayQuestion, XRAY_SYSTEM_PROMPT } from '@/lib/xray/prompt'
import { parseRepoInput } from '@/lib/xray/repo-ref'
import { finalizeReport } from '@/lib/xray/schema'
import { buildXrayTools, createXraySink, XRAY_TOOLS } from '@/lib/xray/tools'

async function main() {
  const args = process.argv.slice(2)
  const ref = parseRepoInput(args[0] ?? '')
  if (!ref) {
    console.error('usage: scripts/xray-local.ts <owner/repo> [--out file.json] [--locale en]')
    process.exit(2)
  }
  const flag = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const out = flag('--out') ?? `xray-${ref.owner}-${ref.repo}.json`
  const locale = flag('--locale') ?? 'en'
  const fullName = `${ref.owner}/${ref.repo}`
  const sink = createXraySink()
  let filesTotal: number | null = null
  const started = Date.now()
  const stamp = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s`

  const result = await runCodeAnalysis({
    runId: `local-${Date.now()}`,
    fullName,
    question: xrayQuestion(fullName),
    systemPrompt: XRAY_SYSTEM_PROMPT,
    locale,
    maxTurns: XRAY_MAX_TURNS,
    maxTotalTokens: XRAY_MAX_TOTAL_TOKENS,
    extraServers: (dir) => [{ name: 'supalens_xray', server: buildXrayTools(dir, sink), tools: XRAY_TOOLS }],
    onCloned: async (dir) => {
      const info = await cloneInfo(dir)
      filesTotal = info.fileCount
      console.log(`${stamp()} cloned ${info.fileCount} files @ ${info.sha?.slice(0, 7)}`)
    },
    emit: (chunk) => {
      if (chunk.type === 'status') console.log(`${stamp()} status ${chunk.status}`)
      if (chunk.type === 'tool_use') {
        const name = chunk.tool.replace(/^mcp__[a-z_]+__/, '')
        const input = (chunk.input ?? {}) as Record<string, unknown>
        const detail = name === 'note' ? `[${input.kind}] ${input.text}` : name === 'submit_xray' ? '' : JSON.stringify(input).slice(0, 120)
        console.log(`${stamp()} ${name.padEnd(12)} ${detail}`)
      }
    },
  })

  console.log(`\nturns=${result.turns} cost=$${result.costUsd.toFixed(3)} tokens=${result.tokensIn}/${result.tokensOut} submissions=${sink.attempts}`)
  if (!sink.report) {
    console.error(`no report: ${result.error ?? 'the agent never submitted an accepted report'}`)
    process.exit(1)
  }
  const report = finalizeReport(sink.report, filesTotal)
  await writeFile(out, JSON.stringify(report, null, 2))
  console.log(`grade ${report.grade} (${report.score}) · ${report.traps.length} traps · ${report.kpis.length} KPIs → ${out}`)
  console.log(`headline: ${report.headline}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
