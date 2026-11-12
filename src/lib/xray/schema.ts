// NOT `import 'server-only'` — shared by the Trigger task (agent tool + persistence) and the
// /x pages, the same way lib/viz/spec.ts is shared by the agent and the renderer.
//
// The X-ray report is ONE declarative document. The agent fills it through the in-process
// `submit_xray` tool; the tool replaces every code excerpt with the real lines read from the
// clone (the model only POINTS at code — it never gets to write what the code "says"), and the
// score/grade are computed here from the traps, never chosen by the model.
import { z } from 'zod'

export const XRAY_VERSION = 1

/** "path:line" or "path" — a pointer into the repo, rendered as mono text only. */
const refSchema = z.string().min(1).max(200)

export const trapSideSchema = z.object({
  /** short name for this side, e.g. "Billing" / "Admin dashboard" */
  label: z.string().min(1).max(60),
  /** does THIS side count the number the way the business means it? */
  verdict: z.enum(['right', 'wrong', 'unclear']),
  path: z.string().min(1).max(300),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  /** line numbers inside [startLine, endLine] that carry the difference */
  highlight: z.array(z.number().int().min(1)).max(12).optional(),
})

export const fixLineSchema = z.object({
  op: z.enum([' ', '-', '+']),
  text: z.string().max(300),
})

export const trapSchema = z.object({
  title: z.string().min(1).max(110),
  explanation: z.string().min(1).max(420),
  /** certain = the code alone proves the two definitions differ; needs_data = only data can confirm */
  severity: z.enum(['certain', 'needs_data']),
  /** the business area this trap belongs to (matches an `areas[].name`) */
  area: z.string().min(1).max(40),
  impact: z.array(z.string().min(1).max(24)).max(3).optional(),
  sides: z.array(trapSideSchema).min(1).max(2),
  fix: z
    .object({
      path: z.string().min(1).max(300),
      lines: z.array(fixLineSchema).min(1).max(16),
    })
    .optional(),
})

export const flowStepSchema = z.object({
  label: z.string().min(1).max(40),
  entity: z.string().max(60).optional(),
  ref: refSchema.optional(),
})

export const flowBranchSchema = z.object({
  label: z.string().min(1).max(40),
  detail: z.string().min(1).max(90),
  /** 1-based index of the step this branch hangs under */
  under: z.number().int().min(1).max(6),
  ref: refSchema.optional(),
  /** 1-based index of the trap this branch is part of, if any */
  trap: z.number().int().min(1).max(5).optional(),
})

export const kpiSchema = z.object({
  name: z.string().min(1).max(48),
  /** the code that defines it; dropped at verification when the file doesn't exist */
  ref: refSchema.optional(),
  watch: z.enum(['anomaly', 'threshold']),
})

// Tight on purpose: these render on the grade plate and the share card, one line each.
export const areaSchema = z.object({
  name: z.string().min(1).max(20),
  status: z.enum(['split', 'needs_data', 'consistent']),
  note: z.string().min(1).max(20),
})

/** What the agent submits (and, after verification, what is stored as `report`). */
export const xraySubmissionShape = {
  /** what the product calls itself (README / package / UI copy), e.g. "dailycart" */
  productName: z.string().min(1).max(40).optional(),
  headline: z.string().min(1).max(120),
  summary: z.string().min(1).max(480),
  businessModel: z.string().min(1).max(120),
  moneyFlow: z.object({
    steps: z.array(flowStepSchema).min(2).max(6),
    branches: z.array(flowBranchSchema).max(3).optional(),
    note: z.object({ label: z.string().min(1).max(40), text: z.string().min(1).max(160), ref: refSchema.optional() }).optional(),
  }),
  traps: z.array(trapSchema).max(5),
  kpis: z.array(kpiSchema).max(8),
  areas: z.array(areaSchema).max(5),
  supabase: z.object({
    found: z.boolean(),
    evidence: z.array(z.string().min(1).max(160)).max(3).optional(),
  }),
  rulesRead: z.number().int().min(0).max(500),
}
export const xraySubmissionSchema = z.object(xraySubmissionShape)

/** What submit_xray ACCEPTS: stricter than what storage parses (older rows stay readable).
 *  The product name is required (sentences read "How dailycart makes money", not "How app …")
 *  and the headline must fit the share card. */
export const xraySubmitShape = {
  ...xraySubmissionShape,
  productName: z.string().min(1).max(40),
  headline: z.string().min(1).max(100),
}
export const xraySubmitSchema = z.object(xraySubmitShape)
export type XraySubmission = z.infer<typeof xraySubmissionSchema>
export type XrayTrap = z.infer<typeof trapSchema>

/** One real source line copied from the clone (after redaction). */
export interface ExcerptLine {
  n: number
  text: string
  mark?: 'good' | 'bad'
}

export type VerifiedTrapSide = z.infer<typeof trapSideSchema> & { lines: ExcerptLine[] }
export type VerifiedTrap = Omit<XrayTrap, 'sides'> & { sides: VerifiedTrapSide[] }

/** The stored document (`xray_reports.report`). */
export type XrayReport = Omit<XraySubmission, 'traps'> & {
  v: typeof XRAY_VERSION
  traps: VerifiedTrap[]
  score: number
  grade: string
  filesTotal: number | null
}

const excerptLineSchema = z.object({ n: z.number().int().min(1), text: z.string().max(400), mark: z.enum(['good', 'bad']).optional() })
const storedReportSchema = z.object({
  ...xraySubmissionShape,
  v: z.literal(XRAY_VERSION),
  traps: z.array(trapSchema.extend({ sides: z.array(trapSideSchema.extend({ lines: z.array(excerptLineSchema).max(16) })).min(1).max(2) })).max(5),
  score: z.number().int().min(0).max(100),
  grade: z.string().min(1).max(3),
  filesTotal: z.number().int().min(0).nullable(),
})

/** Parse a stored report defensively — a row written by an older/newer version renders as missing, never crashes. */
export function parseStoredReport(raw: unknown): XrayReport | null {
  const parsed = storedReportSchema.safeParse(raw)
  return parsed.success ? (parsed.data as XrayReport) : null
}

/* ---------- grading (pure, pinned by schema.test.ts) ---------- */

/** Start at 100; a trap certain from code costs 10, one that needs a data check costs 3. */
export function scoreFor(traps: Pick<XrayTrap, 'severity'>[]): number {
  let score = 100
  for (const trap of traps) score -= trap.severity === 'certain' ? 10 : 3
  return Math.max(0, score)
}

/** US letter bands: 97+ A+, 93–96 A, 90–92 A−, 87–89 B+ … 60–62 D−, below 60 F. ASCII '-' is stored. */
export function gradeFor(score: number): string {
  if (score < 60) return 'F'
  const letter = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : 'D'
  const ones = score >= 100 ? 9 : score % 10
  if (ones >= 7) return `${letter}+`
  if (ones <= 2) return `${letter}-`
  return letter
}

/** Display form: typographic minus. */
export function displayGrade(grade: string): string {
  return grade.replace('-', '−')
}

/** The verified submission → the stored report: version stamp, score and grade computed here. */
export function finalizeReport(
  verified: Omit<XraySubmission, 'traps'> & { traps: VerifiedTrap[] },
  filesTotal: number | null,
): XrayReport {
  const score = scoreFor(verified.traps)
  return { ...verified, v: XRAY_VERSION, score, grade: gradeFor(score), filesTotal }
}
