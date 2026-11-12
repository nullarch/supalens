// NOT server-only — the Trigger task emits these, the scan page reduces them.
//
// The scan page shows five stages, a live log and four counters. The stream carries only what
// happened (cloned, a file was read, a note, a search, the report is being written); the stage
// is DERIVED here, so the task stays dumb and the UI logic is pure and pin-tested.
import type { XrayNoteKind } from './tools'

export type XrayEvent =
  | { type: 'cloned'; files: number }
  | { type: 'read'; path: string }
  | { type: 'search'; pattern: string }
  | { type: 'note'; kind: XrayNoteKind; text: string; count?: number }
  | { type: 'writing' }
  | { type: 'done'; ok: boolean }

/** 1 fetch · 2 schema · 3 money · 4 cross-check · 5 writing · 6 complete */
export type XrayStage = 1 | 2 | 3 | 4 | 5 | 6

export type XrayLogLine =
  | { kind: 'read'; text: string }
  | { kind: 'search'; text: string }
  | { kind: XrayNoteKind; text: string }

export interface XrayScanState {
  stage: XrayStage
  filesTotal: number | null
  filesRead: number
  counts: Record<XrayNoteKind, number>
  log: XrayLogLine[]
  lastRead: string | null
  failed: boolean
  /** keys of notes already counted (noteKey) — a restated note neither logs nor counts twice */
  seenNotes: string[]
}

export const XRAY_LOG_LINES = 11

// After this many file reads the schema is surely read; after this many the money is traced.
const SCHEMA_READS = 5
const MONEY_READS = 14

/** Models restate notes in slightly different words ("Core tables: users, …" twice). Kind + the
 *  first 24 normalized characters is a good-enough identity; the tool handler uses the same key. */
export function noteKey(kind: string, text: string): string {
  return `${kind}:${text.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim().slice(0, 24)}`
}

export function initialScanState(): XrayScanState {
  return { stage: 1, filesTotal: null, filesRead: 0, counts: { entity: 0, rule: 0, kpi: 0, trap: 0 }, log: [], lastRead: null, failed: false, seenNotes: [] }
}

function atLeast(stage: XrayStage, floor: XrayStage): XrayStage {
  return (Math.max(stage, floor) as XrayStage)
}

export function reduceScan(state: XrayScanState, event: XrayEvent): XrayScanState {
  const push = (line: XrayLogLine) => [...state.log, line].slice(-XRAY_LOG_LINES)
  switch (event.type) {
    case 'cloned':
      return { ...state, filesTotal: event.files, stage: atLeast(state.stage, 2) }
    case 'read': {
      const filesRead = state.filesRead + 1
      let stage = atLeast(state.stage, 2)
      if (filesRead >= SCHEMA_READS) stage = atLeast(stage, 3)
      if (filesRead >= MONEY_READS) stage = atLeast(stage, 4)
      return { ...state, filesRead, stage, lastRead: event.path, log: push({ kind: 'read', text: event.path }) }
    }
    case 'search':
      return { ...state, stage: atLeast(state.stage, 2), log: push({ kind: 'search', text: event.pattern }) }
    case 'note': {
      const key = noteKey(event.kind, event.text)
      if (state.seenNotes.includes(key)) return state
      const counts = { ...state.counts, [event.kind]: state.counts[event.kind] + Math.max(1, Math.min(50, event.count ?? 1)) }
      let stage = atLeast(state.stage, 2)
      if (event.kind === 'entity' || event.kind === 'rule') stage = atLeast(stage, 3)
      if (event.kind === 'trap') stage = atLeast(stage, 4)
      return { ...state, counts, stage, seenNotes: [...state.seenNotes, key], log: push({ kind: event.kind, text: event.text }) }
    }
    case 'writing':
      return { ...state, stage: atLeast(state.stage, 5) }
    case 'done':
      return event.ok ? { ...state, stage: 6 } : { ...state, failed: true }
  }
}

export function reduceScanEvents(events: readonly XrayEvent[]): XrayScanState {
  return events.reduce(reduceScan, initialScanState())
}

/** Progress for the bar: stages dominate, file reads nudge it within a stage. */
export function scanProgress(state: XrayScanState): number {
  const base = [0, 4, 18, 38, 62, 88, 100][state.stage]
  const next = [0, 18, 38, 62, 88, 98, 100][state.stage]
  const within = Math.min(1, state.filesRead / MONEY_READS)
  return Math.round(state.stage >= 5 ? base : base + (next - base) * within * 0.9)
}
