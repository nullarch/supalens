// Shared shapes for the public demo page (server page ↔ client console). No imports.

export type DemoSuggestionGroup = 'revenue' | 'diagnose' | 'customers'

export interface DemoSuggestion {
  group: DemoSuggestionGroup
  question: string
}

export interface DemoAnswerResult {
  text?: string
  visualizations?: unknown[]
}

/** A recent live answer for a suggested question, read at render time from the demo cache. */
export interface DemoPreloadedAnswer {
  result: DemoAnswerResult
  answeredAt: string
}

export interface DemoConsoleTable {
  name: string
  rows: number | null
  columns: string[]
}

/** Window event other sections dispatch to ask the console a question. */
export const DEMO_ASK_EVENT = 'supalens:demo-ask'

export const DEMO_CONNECT_HREF = '/login?next=%2Fapp%2Fsources%3Fconnect%3Dsupabase'
