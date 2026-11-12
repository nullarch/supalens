// NOT `import 'server-only'` — runs in the Trigger.dev runtime.
//
// The X-ray's two in-process tools, served next to the read-only file tools (code-agent/tools.ts)
// and jailed to the same clone:
//   note(kind, text)   — a one-line discovery that streams live to the person waiting.
//   submit_xray(report) — the final structured report.
//
// Accuracy is structural (the propose_kpi / propose_visualization pattern): the model only POINTS
// at code (path + line range); this handler reads those lines from disk, redacts anything
// secret-looking, and stores THAT. A range that doesn't exist, escapes the repo, or names a
// secret file is rejected with the reason, so the model repairs and resubmits. Nothing here
// writes, executes or reaches the network.
import { readFile, stat } from 'fs/promises'

import { createSdkMcpServer, tool } from '@/lib/llm/agent-sdk'
import { z } from 'zod'

import { jail, SECRET_RE } from '@/lib/code-agent/tools'
import { noteKey } from './events'
import { redactLine } from './redact'
import {
  xraySubmitSchema,
  xraySubmitShape,
  type ExcerptLine,
  type VerifiedTrap,
  type XraySubmission,
} from './schema'

export const XRAY_TOOLS = ['mcp__supalens_xray__note', 'mcp__supalens_xray__submit_xray'] as const

export type XrayNoteKind = 'entity' | 'rule' | 'kpi' | 'trap'
export interface XrayNote {
  kind: XrayNoteKind
  text: string
  /** how many items the note covers ("6 entities: …" → 6) */
  count: number
}

/** Collects what the agent hands back. One sink per scan. */
export interface XraySink {
  notes: XrayNote[]
  /** the last ACCEPTED submission, with real excerpts */
  report: (Omit<XraySubmission, 'traps'> & { traps: VerifiedTrap[] }) | null
  attempts: number
}

export function createXraySink(): XraySink {
  return { notes: [], report: null, attempts: 0 }
}

const MAX_NOTES = 40
const MAX_EXCERPT_LINES = 14
const MAX_SUBMISSIONS = 4
const MAX_FILE_BYTES = 512 * 1024

/** Read [start, end] (1-based, inclusive) from a repo file, or explain why not. */
export async function readExcerpt(
  cloneDir: string,
  path: string,
  start: number,
  end: number,
): Promise<{ ok: true; lines: { n: number; text: string }[] } | { ok: false; reason: string }> {
  if (SECRET_RE.test(path)) return { ok: false, reason: `${path} is a secret-bearing file and can't be quoted` }
  if (end < start) return { ok: false, reason: `${path}: endLine ${end} is before startLine ${start}` }
  if (end - start + 1 > MAX_EXCERPT_LINES) {
    return { ok: false, reason: `${path}:${start}-${end} is ${end - start + 1} lines; quote at most ${MAX_EXCERPT_LINES}` }
  }
  const abs = await jail(cloneDir, path)
  if (!abs) return { ok: false, reason: `${path} does not exist in the repository` }
  try {
    const st = await stat(abs)
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return { ok: false, reason: `${path} is not a readable source file` }
    const all = (await readFile(abs, 'utf8')).split(/\r?\n/)
    if (start > all.length) return { ok: false, reason: `${path} has only ${all.length} lines (asked for ${start}-${end})` }
    const lines = all.slice(start - 1, Math.min(end, all.length)).map((text, i) => ({
      n: start + i,
      text: redactLine(text.replace(/\t/g, '  ')).slice(0, 400),
    }))
    return { ok: true, lines }
  } catch {
    return { ok: false, reason: `${path} could not be read` }
  }
}

/** "path:line" / "path" refs point at real files, or are dropped (they are decoration, not claims). */
async function keepRealRef(cloneDir: string, ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined
  const path = ref.replace(/:\d+(?:-\d+)?$/, '')
  if (SECRET_RE.test(path)) return undefined
  return (await jail(cloneDir, path)) ? ref : undefined
}

/**
 * Verify a parsed submission against the clone. Returns the stored form, or the list of problems
 * the model must fix. Exported for tests (the tool handler is a thin wrapper).
 */
export async function verifySubmission(
  cloneDir: string,
  input: XraySubmission,
): Promise<{ ok: true; report: NonNullable<XraySink['report']> } | { ok: false; problems: string[] }> {
  const problems: string[] = []
  const traps: VerifiedTrap[] = []
  for (const [ti, trap] of input.traps.entries()) {
    const sides = []
    for (const side of trap.sides) {
      const excerpt = await readExcerpt(cloneDir, side.path, side.startLine, side.endLine)
      if (!excerpt.ok) {
        problems.push(`traps[${ti}] (${trap.title}): ${excerpt.reason}`)
        continue
      }
      const highlight = new Set(side.highlight ?? [])
      const mark: ExcerptLine['mark'] = side.verdict === 'right' ? 'good' : side.verdict === 'wrong' ? 'bad' : undefined
      sides.push({
        ...side,
        lines: excerpt.lines.map((line) => (highlight.has(line.n) && mark ? { ...line, mark } : line)),
      })
    }
    const fix = trap.fix
      ? { path: trap.fix.path, lines: trap.fix.lines.map((line) => ({ op: line.op, text: redactLine(line.text).slice(0, 300) })) }
      : undefined
    if (fix && !(await jail(cloneDir, fix.path))) problems.push(`traps[${ti}].fix: ${fix.path} does not exist in the repository`)
    traps.push({ ...trap, sides, fix })
  }
  for (const [bi, branch] of (input.moneyFlow.branches ?? []).entries()) {
    if (branch.under > input.moneyFlow.steps.length) {
      problems.push(`moneyFlow.branches[${bi}].under = ${branch.under}, but there are only ${input.moneyFlow.steps.length} steps`)
    }
    if (branch.trap && branch.trap > input.traps.length) {
      problems.push(`moneyFlow.branches[${bi}].trap = ${branch.trap}, but there are only ${input.traps.length} traps`)
    }
  }
  if (problems.length) return { ok: false, problems }

  const [steps, kpis] = await Promise.all([
    Promise.all(input.moneyFlow.steps.map(async (step) => ({ ...step, ref: await keepRealRef(cloneDir, step.ref) }))),
    Promise.all(input.kpis.map(async (kpi) => ({ ...kpi, ref: await keepRealRef(cloneDir, kpi.ref) }))),
  ])
  const branches = await Promise.all(
    (input.moneyFlow.branches ?? []).map(async (branch) => ({ ...branch, ref: await keepRealRef(cloneDir, branch.ref) })),
  )
  const note = input.moneyFlow.note ? { ...input.moneyFlow.note, ref: await keepRealRef(cloneDir, input.moneyFlow.note.ref) } : undefined
  return {
    ok: true,
    report: { ...input, moneyFlow: { steps, branches, note }, kpis, traps },
  }
}

const noteShape = {
  kind: z.enum(['entity', 'rule', 'kpi', 'trap']),
  text: z.string().min(1).max(160),
  count: z.number().int().min(1).max(50).optional(),
}

export function buildXrayTools(cloneDir: string, sink: XraySink) {
  return createSdkMcpServer({
    name: 'supalens_xray',
    instructions: 'Report findings for the X-ray: note() live discoveries, then submit_xray() the final report once.',
    tools: [
      tool(
        'note',
        'Share one short discovery with the person watching the scan (an entity, a business rule, a KPI, or a likely metric trap). One sentence, plain words.',
        noteShape,
        async ({ kind, text, count }) => {
          const key = noteKey(kind, text)
          const repeat = sink.notes.some((note) => noteKey(note.kind, note.text) === key)
          if (repeat) return { content: [{ type: 'text' as const, text: 'already noted — do not repeat notes' }] }
          if (sink.notes.length < MAX_NOTES) sink.notes.push({ kind, text: text.slice(0, 160), count: count ?? 1 })
          return { content: [{ type: 'text' as const, text: 'noted' }] }
        },
      ),
      tool(
        'submit_xray',
        'Submit the finished X-ray report. Code excerpts are copied from the files you point at (path + startLine..endLine, at most 14 lines). Call once at the end; if problems come back, fix them and call again.',
        xraySubmitShape,
        async (raw) => {
          sink.attempts += 1
          if (sink.attempts > MAX_SUBMISSIONS) {
            return { content: [{ type: 'text' as const, text: 'Too many submissions. Stop now.' }], isError: true }
          }
          const parsed = xraySubmitSchema.safeParse(raw)
          if (!parsed.success) {
            const issues = parsed.error.issues.slice(0, 12).map((i) => `${i.path.join('.')}: ${i.message}`)
            return { content: [{ type: 'text' as const, text: `Report rejected:\n${issues.join('\n')}` }], isError: true }
          }
          const verified = await verifySubmission(cloneDir, parsed.data)
          if (!verified.ok) {
            return {
              content: [{ type: 'text' as const, text: `Report rejected — fix these and submit again:\n${verified.problems.slice(0, 12).join('\n')}` }],
              isError: true,
            }
          }
          sink.report = verified.report
          return { content: [{ type: 'text' as const, text: 'Report accepted. You are done — stop now.' }] }
        },
      ),
    ],
  })
}
