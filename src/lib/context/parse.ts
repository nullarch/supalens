/**
 * SUPALENS.md → structure. PURE (no io, no React, no server imports) so the Business Model
 * screen, tests, and any future approval model can share it.
 *
 * The context doc is authored two ways (see baseline.ts / generate.ts):
 *   tier-1 (baseline) — a deterministic schema digest: "## Detected conventions" + "## Tables"
 *     with one "### table" per object and "- `column` type [tags]" bullets.
 *   tier-2 (repo)     — LLM-authored per CONTEXT_GEN_PROMPT: Overview · Entity ↔ table map ·
 *     Key tables/columns · Enum/status/coded values · Relationships · Common query patterns &
 *     filters · Gotchas. Free-form Markdown (bullets, pipe tables, nested lists, code fences).
 *
 * This is the "Markdown 임시 파싱" tier: heading-based sectioning that is tolerant to the
 * generator's variations. It never throws — an unrecognised doc yields empty arrays and `raw`.
 */

export type SectionKind =
  | 'overview'
  | 'entities'
  | 'tables'
  | 'enums'
  | 'relationships'
  | 'filters'
  | 'gotchas'
  | 'conventions'
  | 'metrics'
  | 'other'

/** Which doc section a rule came from — the UI groups by this. */
export type RuleSection = Exclude<SectionKind, 'overview' | 'entities' | 'tables' | 'gotchas' | 'metrics' | 'other'>

export interface ParsedEntity {
  /** Domain concept as the code names it (or the table itself for a baseline doc). */
  name: string
  /** Physical table / collection. */
  table: string
  description?: string
}

export interface ParsedRule {
  /** Plain-language rule; backticks are preserved so the UI can render identifiers as code. */
  text: string
  section: RuleSection
  /** file:line references and backticked identifiers found in the rule (deduped, ≤ 8). */
  evidence?: string[]
  /** The generator writes "unconfirmed" when it could not ground a claim. */
  confidence?: 'unconfirmed'
}

export interface ParsedMetric {
  name: string
  definition: string
  sql?: string
}

export interface ParsedSection {
  title: string
  kind: SectionKind
  level: number
}

export interface ParsedContext {
  title: string
  overview?: string
  entities: ParsedEntity[]
  rules: ParsedRule[]
  metrics: ParsedMetric[]
  gotchas: string[]
  sections: ParsedSection[]
  /** True when the doc is the deterministic schema digest (no code-derived meaning). */
  looksBaseline: boolean
  raw: string
}

const MAX_EVIDENCE = 8

// ── section classification ───────────────────────────────────────────────────────────────

const KIND_RULES: Array<[SectionKind, RegExp]> = [
  ['entities', /(entit|model|엔티티|모델).*(map|table|collection|↔|→|->|매핑)|entity\s*map|entities/i],
  ['enums', /enum|status|coded|code(d)? values|state|상태|코드|열거/i],
  ['relationships', /relationship|join|foreign|관계|조인/i],
  ['filters', /query pattern|filter|common quer|where|scop|필터|쿼리 패턴|조회 패턴/i],
  ['gotchas', /gotcha|caveat|pitfall|warning|주의|함정/i],
  ['conventions', /convention|관례|규약/i],
  ['metrics', /\bkpi|metric|measure|지표/i],
  ['tables', /key tables|tables|collections|columns|schema|테이블|컬렉션|컬럼/i],
  ['overview', /overview|summary|about|개요|요약/i],
]

export function classifySection(title: string): SectionKind {
  const t = title.trim()
  for (const [kind, re] of KIND_RULES) if (re.test(t)) return kind
  return 'other'
}

// ── markdown helpers ─────────────────────────────────────────────────────────────────────

interface Block {
  title: string
  level: number
  kind: SectionKind
  lines: string[]
}

/** Split into heading-delimited blocks. Code fences are kept verbatim inside their block. */
function splitBlocks(md: string): { title: string; blocks: Block[] } {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let title = ''
  let cur: Block | null = null
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence
    const h = !inFence ? line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/) : null
    if (h) {
      const level = h[1].length
      const text = h[2].trim()
      if (level === 1 && !title) {
        title = text
        cur = null
        continue
      }
      cur = { title: text, level, kind: classifySection(text), lines: [] }
      blocks.push(cur)
      continue
    }
    if (!cur) {
      // preamble under the H1 → treat as an implicit overview block
      if (line.trim()) {
        cur = { title: 'Overview', level: 2, kind: 'overview', lines: [] }
        blocks.push(cur)
      } else continue
    }
    cur.lines.push(line)
  }
  return { title, blocks }
}

/** Strip emphasis/link markup for display; keep backticks (rendered as code) and plain text. */
export function cleanInline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const FILE_REF = /(?:^|[\s(`"'])((?:[\w@./-]+\/)?[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|php|sql|prisma|graphql|proto|ya?ml|toml|json|cs|scala|ex|exs)(?::\d+(?:-\d+)?)?)/g

/** file:line refs + backticked identifiers (tables/columns/constants) → evidence chips. */
export function extractEvidence(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (v: string) => {
    const k = v.trim()
    if (!k || k.length > 80 || seen.has(k)) return
    seen.add(k)
    out.push(k)
  }
  for (const m of text.matchAll(FILE_REF)) push(m[1])
  for (const m of text.matchAll(/`([^`\n]{1,60})`/g)) {
    const v = m[1].trim()
    // skip prose-y or value-only tokens; keep identifiers and short expressions
    if (/^[\w.$-]+(?:\s*(?:=|!=|<>|is|in|->|→)\s*[\w'".()-]+)?$/i.test(v) || /^[\w.-]+\.[\w-]+$/.test(v)) push(v)
  }
  return out.slice(0, MAX_EVIDENCE)
}

interface Item {
  text: string
  children: string[]
}

/** Bullets (with nested children flattened under their parent) and pipe-table rows as items. */
function itemsOf(lines: string[]): Item[] {
  const items: Item[] = []
  let inFence = false
  let tableHeaderSeen = false
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const line = raw.replace(/\t/g, '    ')
    if (!line.trim()) continue
    // pipe table
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim())
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) {
        tableHeaderSeen = true
        continue
      }
      if (!tableHeaderSeen && items.length === 0) {
        // first row before a separator = header; remember nothing, skip
        tableHeaderSeen = false
        // peek: header rows are usually followed by a separator; we can't peek, so mark and skip
        items.push({ text: `__HEADER__${cells.join('|')}`, children: [] })
        continue
      }
      items.push({ text: cells.filter(Boolean).join(' — '), children: [] })
      continue
    }
    const b = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (b) {
      const indent = b[1].length
      const text = b[2].trim()
      if (indent >= 2 && items.length) items[items.length - 1].children.push(text)
      else items.push({ text, children: [] })
      continue
    }
    // continuation line of the previous bullet (indented prose)
    if (/^\s{2,}\S/.test(line) && items.length) {
      items[items.length - 1].text += ' ' + line.trim()
    }
  }
  // drop the table header pseudo-row (it was only kept to keep separator logic simple)
  return items.filter((i) => !i.text.startsWith('__HEADER__'))
}

function joinItem(i: Item): string {
  if (!i.children.length) return i.text
  const head = i.text.replace(/[:：]\s*$/, '')
  return `${head} — ${i.children.join('; ')}`
}

// ── entities ─────────────────────────────────────────────────────────────────────────────

const ARROW = /\s*(?:↔|⇄|→|->|=>|:|—|–|\bmaps? to\b|\bis stored in\b|\bin\b)\s*/i

function entityFromText(text: string): ParsedEntity | null {
  const clean = text.trim()
  if (!clean) return null
  // Prefer explicit "Name → `table`" / "Name — table — description" / "`Name` ↔ `table`"
  const codes = [...clean.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  const bolds = [...clean.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1])
  const split = clean.split(ARROW).map((p) => cleanInline(p.replace(/`/g, '')))
  if (split.length >= 2 && split[0] && split[1]) {
    const name = split[0].replace(/^[-*]\s*/, '')
    const table = split[1].split(/\s[(—–-]\s|\.\s/)[0].split(/\s+/)[0].replace(/[.,;]+$/, '')
    if (/^[\w.]+$/.test(table)) {
      const rest = split.slice(2).join(' — ') || split[1].slice(table.length).replace(/^[\s—–-]+/, '')
      return { name, table, description: rest.trim() || undefined }
    }
  }
  if (bolds[0] && codes[0]) return { name: cleanInline(bolds[0]), table: codes[0], description: undefined }
  if (codes.length >= 2 && /^[\w.]+$/.test(codes[1])) return { name: codes[0], table: codes[1] }
  return null
}

// ── metrics ──────────────────────────────────────────────────────────────────────────────

function metricsOf(block: Block): ParsedMetric[] {
  const out: ParsedMetric[] = []
  // 1) sub-headings inside the block are not possible (headings split blocks), so metrics
  //    written as "### MRR" arrive as sibling blocks — handled by the caller. Here: bullets.
  const sqlBlocks: string[] = []
  let inFence = false
  let fence: string[] = []
  for (const l of block.lines) {
    if (/^\s*```/.test(l)) {
      if (inFence) {
        sqlBlocks.push(fence.join('\n').trim())
        fence = []
      }
      inFence = !inFence
      continue
    }
    if (inFence) fence.push(l)
  }
  const items = itemsOf(block.lines)
  items.forEach((it, idx) => {
    const text = joinItem(it)
    const bold = text.match(/\*\*([^*]+)\*\*/)?.[1] ?? text.match(/^`([^`]+)`/)?.[1]
    const m = text.match(/^(.+?)(?:\s*(?:—|–|:|-)\s+)(.+)$/)
    const name = cleanInline(bold ?? m?.[1] ?? text).slice(0, 80)
    const definition = cleanInline(bold ? text.replace(/\*\*[^*]+\*\*\s*(?:—|–|:|-)?\s*/, '') : (m?.[2] ?? ''))
    if (!name) return
    out.push({ name, definition: definition || cleanInline(text), sql: sqlBlocks[idx] })
  })
  return out
}


/**
 * Fold the "physical" rows a doc produces twice into the concept rows.
 *
 * A tier-2 doc names each table BOTH in the entity map ("Order → `orders`") and again as a
 * "### orders" subsection under Key tables — which would render as two rows for one table, the
 * second one saying "orders → orders". When a self-named row (name === table) duplicates a table
 * some concept already claims, its column digest is merged into that concept and the row drops.
 * A baseline doc has only self-named rows and is therefore untouched.
 */
function mergePhysicalEntities(entities: ParsedEntity[]): ParsedEntity[] {
  const conceptByTable = new Map<string, ParsedEntity>()
  for (const e of entities) {
    if (e.name.toLowerCase() !== e.table.toLowerCase()) conceptByTable.set(e.table.toLowerCase(), e)
  }
  const out: ParsedEntity[] = []
  for (const e of entities) {
    const concept = e.name.toLowerCase() === e.table.toLowerCase() ? conceptByTable.get(e.table.toLowerCase()) : undefined
    if (!concept) {
      out.push(e)
      continue
    }
    if (e.description && !concept.description) concept.description = e.description
    else if (e.description && concept.description && !concept.description.includes(e.description)) {
      concept.description = `${concept.description} · ${e.description}`
    }
  }
  return out
}

// ── main ─────────────────────────────────────────────────────────────────────────────────

export function parseSupalensMd(md: string): ParsedContext {
  const raw = md ?? ''
  const { title, blocks } = splitBlocks(raw)
  const looksBaseline = /auto-generated baseline/i.test(title) || /generated from the introspected schema only/i.test(raw)

  const entities: ParsedEntity[] = []
  const rules: ParsedRule[] = []
  const metrics: ParsedMetric[] = []
  const gotchas: string[] = []
  const sections: ParsedSection[] = blocks.map((b) => ({ title: b.title, kind: b.kind, level: b.level }))
  let overview: string | undefined

  // Baseline "## Tables" → each "### table" block becomes an entity (table = name).
  // Also true for tier-2 docs that use one H3 per table under "Key tables".
  let parentKind: SectionKind = 'other'
  let parentLevel = 0
  let metricsParentActive = false
  const seenEntity = new Set<string>()

  const pushEntity = (e: ParsedEntity | null) => {
    if (!e || !e.table) return
    const key = `${e.name}→${e.table}`.toLowerCase()
    if (seenEntity.has(key)) return
    seenEntity.add(key)
    entities.push(e)
  }
  const pushRule = (text: string, section: RuleSection) => {
    const t = cleanInline(text)
    if (!t || t.length < 3) return
    const evidence = extractEvidence(text)
    rules.push({
      text: t,
      section,
      evidence: evidence.length ? evidence : undefined,
      confidence: /unconfirmed/i.test(t) ? 'unconfirmed' : undefined,
    })
  }

  for (const b of blocks) {
    if (b.level <= parentLevel) {
      parentKind = 'other'
      parentLevel = 0
      metricsParentActive = false
    }
    const kind: SectionKind =
      b.kind === 'other' && b.level > parentLevel && parentKind !== 'other' ? parentKind : b.kind
    const items = itemsOf(b.lines)
    const prose = b.lines
      .filter((l) => l.trim() && !/^\s*(?:[-*+]|\d+[.)])\s/.test(l) && !/^\s*\|/.test(l) && !/^\s*```/.test(l))
      .map((l) => cleanInline(l))
      .join(' ')

    switch (kind) {
      case 'overview':
        if (!overview && prose) overview = prose
        break
      case 'entities':
        for (const it of items) pushEntity(entityFromText(joinItem(it)))
        // a "### Name" subsection under the entity map = one entity described in prose
        if (b.level > 2 && items.length === 0 && prose) pushEntity(entityFromText(`${b.title} — ${prose}`))
        break
      case 'tables': {
        // "### orders" subsection → entity; its bullets are columns (baseline) or facts (tier-2)
        if (b.level >= 3) {
          const name = b.title.replace(/\s*\((table|view|collection|materialized view)\)\s*$/i, '').trim()
          const cols = items.map((i) => i.text.match(/^`([^`]+)`/)?.[1]).filter((c): c is string => !!c)
          const facts = items.filter((i) => !/^`[^`]+`(\s|$)/.test(i.text))
          const desc = prose || (cols.length ? `${cols.length} columns · ${cols.slice(0, 6).join(', ')}${cols.length > 6 ? ', …' : ''}` : undefined)
          pushEntity({ name, table: name, description: desc })
          for (const f of facts) pushRule(`\`${name}\`: ${joinItem(f)}`, 'filters')
        } else {
          for (const it of items) {
            const e = entityFromText(joinItem(it))
            if (e && e.description) pushEntity(e)
            else if (e) pushEntity(e)
            else pushRule(joinItem(it), 'filters')
          }
        }
        break
      }
      case 'enums':
        for (const it of items) pushRule(joinItem(it), 'enums')
        break
      case 'relationships':
        for (const it of items) pushRule(joinItem(it), 'relationships')
        break
      case 'filters':
        for (const it of items) pushRule(joinItem(it), 'filters')
        break
      case 'conventions':
        for (const it of items) pushRule(joinItem(it), 'conventions')
        break
      case 'gotchas':
        for (const it of items) {
          const t = cleanInline(joinItem(it))
          if (t) gotchas.push(t)
        }
        if (items.length === 0 && prose) gotchas.push(prose)
        break
      case 'metrics':
        if (b.level >= 3 && metricsParentActive) {
          // "### MRR" under a KPI section: heading = name, prose = definition, fence = sql
          const sql = b.lines.join('\n').match(/```(?:sql)?\n([\s\S]*?)```/i)?.[1]?.trim()
          metrics.push({ name: cleanInline(b.title), definition: prose || cleanInline(items.map(joinItem).join(' ')), sql })
        } else {
          metrics.push(...metricsOf(b))
          metricsParentActive = true
        }
        break
      default:
        // unclassified prose sections are kept only as section entries (visible in Raw)
        break
    }
    if (b.level <= 2) {
      parentKind = kind
      parentLevel = b.level
      if (kind !== 'metrics') metricsParentActive = false
    }
  }

  return { title, overview, entities: mergePhysicalEntities(entities), rules, metrics, gotchas, sections, looksBaseline, raw }
}

/** Convenience counts for list rows without re-walking the arrays in the UI. */
export function summarizeContext(p: ParsedContext): { entities: number; rules: number; metrics: number; gotchas: number } {
  return { entities: p.entities.length, rules: p.rules.length, metrics: p.metrics.length, gotchas: p.gotchas.length }
}

/**
 * Normalised join key for matching a doc metric to a `kpi_catalog` row. The catalog stores a
 * slug `key` ("refund_rate") AND a display `title` ("Refund rate"), while the doc writes a free
 * heading — so both sides collapse to lowercase alphanumerics. Deliberately lossy: it is only
 * used to show "this definition is the one behind that KPI", never to write anything.
 */
export function metricKey(nameOrKey: string): string {
  return (nameOrKey ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '')
    .trim()
}

/**
 * The subset of `evidence` that actually GROUNDS a rule in code — `path/file.ts:52-58` style
 * references. Bare identifiers (`orders.status`, `paid`) are dropped: they already render inline
 * in the rule sentence, so repeating them as chips is noise, not evidence.
 */
const CODE_REF = /(?:^|\/)[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|php|sql|prisma|graphql|proto|ya?ml|toml|json|cs|scala|ex|exs)(?::\d+(?:-\d+)?)?$/i

export function codeRefs(evidence: string[] | undefined): string[] {
  return (evidence ?? []).filter((e) => CODE_REF.test(e))
}
