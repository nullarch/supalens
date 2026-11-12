import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ createSdkMcpServer: vi.fn(), tool: vi.fn() }))

import { initialScanState, reduceScan, reduceScanEvents, scanProgress, type XrayEvent } from './events'
import { redactLine, REDACTED } from './redact'
import { parseRepoInput, xrayPath } from './repo-ref'
import { displayGrade, finalizeReport, gradeFor, parseStoredReport, scoreFor, xraySubmissionSchema, xraySubmitSchema, type XraySubmission } from './schema'
import { readExcerpt, verifySubmission } from './tools'

describe('parseRepoInput', () => {
  it.each([
    ['owner/repo', 'owner', 'repo'],
    ['  Supabase/Supabase  ', 'supabase', 'supabase'],
    ['github.com/vercel/next.js', 'vercel', 'next.js'],
    ['https://github.com/vercel/next.js.git', 'vercel', 'next.js'],
    ['https://www.github.com/a-b/c_d/tree/main/src?x=1#L2', 'a-b', 'c_d'],
    ['git@github.com:owner/repo.git', 'owner', 'repo'],
  ])('accepts %s', (raw, owner, repo) => {
    expect(parseRepoInput(raw)).toEqual({ owner, repo })
  })

  it.each([
    '',
    'owner',
    'https://gitlab.com/owner/repo',
    'gitlab.com/owner/repo',
    'ftp://github.com/owner/repo',
    '-owner/repo',
    'own--er/repo',
    'owner/..',
    'owner/re po',
    'a'.repeat(40) + '/repo',
    'javascript:alert(1)/x',
  ])('rejects %s', (raw) => {
    expect(parseRepoInput(raw)).toBeNull()
  })

  it('builds the canonical path', () => {
    expect(xrayPath({ owner: 'a', repo: 'b' })).toBe('/x/a/b')
  })
})

describe('grading', () => {
  const certain = { severity: 'certain' as const }
  const needsData = { severity: 'needs_data' as const }

  it('starts at 100 and subtracts 10 / 3', () => {
    expect(scoreFor([])).toBe(100)
    expect(scoreFor([certain, certain, needsData])).toBe(77)
    expect(scoreFor(Array(20).fill(certain))).toBe(0)
  })

  it.each([
    [100, 'A+'], [97, 'A+'], [93, 'A'], [90, 'A-'], [89, 'B+'], [85, 'B'], [80, 'B-'],
    [77, 'C+'], [73, 'C'], [70, 'C-'], [67, 'D+'], [60, 'D-'], [59, 'F'], [0, 'F'],
  ])('%i → %s', (score, grade) => {
    expect(gradeFor(score)).toBe(grade)
  })

  it('displays a typographic minus', () => {
    expect(displayGrade('A-')).toBe('A−')
    expect(displayGrade('C+')).toBe('C+')
  })
})

describe('redactLine', () => {
  it.each([
    ['const key = "sk_live_abcdefghijklmnop"'],
    ['ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstu'],
    ['token: ghp_abcdefghijklmnopqrstuvwxyz0123'],
    ['const anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6.abcdefghijklmnop"'],
    ['DATABASE_URL=postgresql://user:hunter2@db.example.com:5432/app'],
    ["password: 'correct-horse-battery'"],
    ['AKIAIOSFODNN7EXAMPLE'],
  ])('redacts %s', (line) => {
    const out = redactLine(line)
    expect(out).toContain(REDACTED)
    expect(out).not.toMatch(/sk_live_abcdef|sk-ant-abcdef|ghp_abcdef|hunter2|correct-horse|AKIAIOSFODNN7|eyJhbGciOiJIUzI1NiIsInR5cCI6\.eyJ/)
  })

  it('keeps ordinary code', () => {
    const line = 'select sum(p.amount) - coalesce(sum(r.amount), 0) from payments p'
    expect(redactLine(line)).toBe(line)
    expect(redactLine('const token = getToken()')).toBe('const token = getToken()')
  })
})

describe('scan reducer', () => {
  it('advances stages from events', () => {
    const events: XrayEvent[] = [{ type: 'cloned', files: 214 }]
    for (let i = 0; i < 5; i++) events.push({ type: 'read', path: `f${i}.ts` })
    let state = reduceScanEvents(events)
    expect(state.filesTotal).toBe(214)
    expect(state.stage).toBe(3)
    state = reduceScan(state, { type: 'note', kind: 'trap', text: 'two revenue definitions' })
    expect(state.stage).toBe(4)
    expect(state.counts.trap).toBe(1)
    state = reduceScan(state, { type: 'writing' })
    expect(state.stage).toBe(5)
    expect(reduceScan(state, { type: 'done', ok: true }).stage).toBe(6)
    expect(reduceScan(state, { type: 'done', ok: false }).failed).toBe(true)
  })

  it('never moves backwards and caps the log', () => {
    let state = reduceScan(initialScanState(), { type: 'writing' })
    state = reduceScan(state, { type: 'read', path: 'late.ts' })
    expect(state.stage).toBe(5)
    for (let i = 0; i < 30; i++) state = reduceScan(state, { type: 'search', pattern: `p${i}` })
    expect(state.log.length).toBe(11)
    expect(state.log.at(-1)).toEqual({ kind: 'search', text: 'p29' })
  })

  it('counts note items and ignores a restated note', () => {
    let state = reduceScan(initialScanState(), { type: 'note', kind: 'entity', text: 'Core tables: users, customers (stripe mapping), products', count: 5 })
    state = reduceScan(state, { type: 'note', kind: 'entity', text: 'Core tables: users, customers, products, prices', count: 5 })
    state = reduceScan(state, { type: 'note', kind: 'rule', text: 'Core tables: users, customers — as a rule this time' })
    expect(state.counts.entity).toBe(5)
    expect(state.counts.rule).toBe(1)
    expect(state.log).toHaveLength(2)
  })

  it('progress is monotonic across stages', () => {
    const at = (stage: number) => scanProgress({ ...initialScanState(), stage: stage as 1 })
    expect(at(1)).toBeLessThan(at(2))
    expect(at(4)).toBeLessThan(at(5))
    expect(at(6)).toBe(100)
  })
})

describe('submission verification', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'xray-test-'))
    await mkdir(join(dir, 'billing'), { recursive: true })
    await mkdir(join(dir, 'api/admin'), { recursive: true })
    await writeFile(
      join(dir, 'billing/mrr.ts'),
      ['export const mrr = sql`', '  select sum(p.amount)', '  - coalesce(sum(r.amount), 0)', '  from payments p', '  left join refunds r using (payment_id)`', 'const k = "sk_live_abcdefghijklmnop"'].join('\n'),
    )
    await writeFile(join(dir, 'api/admin/revenue.ts'), ['export const total = sql`', '  select sum(p.amount)', '  from payments p`'].join('\n'))
    await writeFile(join(dir, '.env'), 'SECRET=1')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const base = (): XraySubmission => ({
    headline: 'dailycart counts its revenue two different ways.',
    summary: 'Billing subtracts refunds; the admin total does not.',
    businessModel: 'A subscription business',
    moneyFlow: {
      steps: [
        { label: 'Sign-up', entity: 'users', ref: 'auth/signup.ts:20' },
        { label: 'Payment', entity: 'payments', ref: 'billing/mrr.ts:2' },
      ],
      branches: [{ label: 'Refund', detail: 'Subtracted in 1 of 2 places', under: 2, trap: 1 }],
    },
    traps: [
      {
        title: 'The admin dashboard never subtracts refunds',
        explanation: 'Billing nets refunds; admin does not.',
        severity: 'certain',
        area: 'Revenue',
        sides: [
          { label: 'Billing', verdict: 'right', path: 'billing/mrr.ts', startLine: 2, endLine: 6, highlight: [3, 6] },
          { label: 'Admin', verdict: 'wrong', path: 'api/admin/revenue.ts', startLine: 2, endLine: 3, highlight: [2] },
        ],
        fix: { path: 'api/admin/revenue.ts', lines: [{ op: '-', text: 'select sum(p.amount)' }, { op: '+', text: 'select sum(p.amount) - coalesce(sum(r.amount), 0)' }] },
      },
    ],
    kpis: [{ name: 'MRR', ref: 'billing/mrr.ts:2', watch: 'anomaly' }, { name: 'Signups', ref: 'nope.ts:1', watch: 'anomaly' }],
    areas: [{ name: 'Revenue', status: 'split', note: '2 definitions' }],
    supabase: { found: false },
    rulesRead: 9,
  })

  it('accepts the schema', () => {
    expect(xraySubmissionSchema.safeParse(base()).success).toBe(true)
  })

  it('submit_xray is stricter than storage: product name required, headline fits the card', () => {
    expect(xraySubmitSchema.safeParse(base()).success).toBe(false)
    expect(xraySubmitSchema.safeParse({ ...base(), productName: 'dailycart' }).success).toBe(true)
    expect(xraySubmitSchema.safeParse({ ...base(), productName: 'dailycart', headline: 'x'.repeat(101) }).success).toBe(false)
    expect(xraySubmissionSchema.safeParse({ ...base(), headline: 'x'.repeat(110) }).success).toBe(true)
  })

  it('copies real lines from disk, marks highlights, redacts secrets and drops fake refs', async () => {
    const result = await verifySubmission(dir, base())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [right, wrong] = result.report.traps[0].sides
    expect(right.lines.map((l) => l.n)).toEqual([2, 3, 4, 5, 6])
    expect(right.lines[1]).toEqual({ n: 3, text: '  - coalesce(sum(r.amount), 0)', mark: 'good' })
    expect(right.lines[4].text).toContain(REDACTED)
    expect(right.lines[4].text).not.toContain('sk_live')
    expect(wrong.lines[0]).toMatchObject({ n: 2, mark: 'bad' })
    expect(result.report.kpis[0].ref).toBe('billing/mrr.ts:2')
    expect(result.report.kpis[1].ref).toBeUndefined()
    expect(result.report.moneyFlow.steps[0].ref).toBeUndefined()
  })

  it('rejects ranges that do not exist, escape the repo, or quote secrets', async () => {
    expect(await readExcerpt(dir, 'billing/mrr.ts', 40, 42)).toMatchObject({ ok: false })
    expect(await readExcerpt(dir, '../etc/passwd', 1, 2)).toMatchObject({ ok: false })
    expect(await readExcerpt(dir, '.env', 1, 1)).toMatchObject({ ok: false })
    expect(await readExcerpt(dir, 'billing/mrr.ts', 1, 30)).toMatchObject({ ok: false })
    const bad = base()
    bad.traps[0].sides[1] = { ...bad.traps[0].sides[1], path: 'api/admin/missing.ts' }
    const result = await verifySubmission(dir, bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems[0]).toContain('does not exist')
  })

  it('rejects branches that point past the steps or traps', async () => {
    const bad = base()
    bad.moneyFlow.branches = [{ label: 'Refund', detail: 'x', under: 5, trap: 3 }]
    const result = await verifySubmission(dir, bad)
    expect(result.ok).toBe(false)
  })

  it('finalizes into a stored report that parses back', async () => {
    const result = await verifySubmission(dir, base())
    if (!result.ok) throw new Error('expected ok')
    const report = finalizeReport(result.report, 214)
    expect(report).toMatchObject({ v: 1, score: 90, grade: 'A-', filesTotal: 214 })
    expect(parseStoredReport(JSON.parse(JSON.stringify(report)))).not.toBeNull()
    expect(parseStoredReport({ nope: true })).toBeNull()
  })
})
