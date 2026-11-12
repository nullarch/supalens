// NOT `import 'server-only'` — runs wherever introspection runs (BFF or Trigger host).
// tier-1 context generator: a deterministic schema digest built from the introspection cache
// (no LLM, no repo). It gives the agent the whole schema + detected conventions up-front, so it
// makes fewer get_schema round-trips and picks better tables/columns. Attaching a git repo
// upgrades this to a tier-2, code-aware doc (see trigger/generate-context.ts, Phase 3).
import { createAdminClient } from '@/utils/supabase/admin'
import { putSourceContext } from './service'

interface ColumnInfo {
  name: string
  type?: string
  nullable?: boolean
  frequency?: number
}
interface ObjectRow {
  schema_name: string
  object_name: string
  object_type: string
  columns: ColumnInfo[] | null
  primary_key: string[] | null
}

const MAX_TABLES = 100
const MAX_COLS = 60

function detectConventions(objects: ObjectRow[]): string[] {
  const cols = new Set<string>()
  for (const o of objects) for (const c of o.columns ?? []) cols.add(c.name.toLowerCase())
  const notes: string[] = []
  if (cols.has('deleted_at'))
    notes.push('- Soft delete: rows with `deleted_at` set are deleted — filter `deleted_at is null` for live rows.')
  if (cols.has('org_id'))
    notes.push('- Multi-tenant: many tables carry `org_id`; scope queries to the relevant organization.')
  if (cols.has('user_id')) notes.push('- Ownership: `user_id` links rows to a user.')
  if (cols.has('created_at') || cols.has('updated_at'))
    notes.push('- Timestamps: `created_at` / `updated_at` are present for recency and ordering.')
  return notes
}

function renderBaselineMarkdown(name: string, engine: string, objects: ObjectRow[]): string {
  const isDoc = engine === 'firestore'
  const noun = isDoc ? 'collection' : 'table'
  const lines: string[] = []
  lines.push(`# ${name} — data source context (auto-generated baseline)`)
  lines.push('')
  lines.push(
    `This is a ${engine} ${isDoc ? 'document store' : 'database'} with ${objects.length} ${noun}(s). ` +
      `This baseline is generated from the introspected schema only. Attach a git repository to this ` +
      `data source to enrich it with code-derived business meaning (what each ${noun}/field represents, ` +
      `enum/status codes, relationships, and common query patterns).`,
  )
  const conventions = detectConventions(objects)
  if (conventions.length) lines.push('', '## Detected conventions', ...conventions)

  lines.push('', `## ${isDoc ? 'Collections' : 'Tables'}`)
  for (const o of objects.slice(0, MAX_TABLES)) {
    const pk = new Set((o.primary_key ?? []).map((p) => p.toLowerCase()))
    const qualified =
      o.schema_name && o.schema_name !== 'public' ? `${o.schema_name}.${o.object_name}` : o.object_name
    const typeTag = o.object_type && o.object_type !== 'table' ? ` (${o.object_type})` : ''
    lines.push('', `### ${qualified}${typeTag}`)
    const cols = o.columns ?? []
    for (const c of cols.slice(0, MAX_COLS)) {
      const tags: string[] = []
      if (pk.has(c.name.toLowerCase()) || (isDoc && c.name === '__id')) tags.push('pk')
      else if (/_id$/.test(c.name)) tags.push('fk?')
      if (c.nullable) tags.push('nullable')
      if (typeof c.frequency === 'number' && c.frequency < 1) tags.push(`${Math.round(c.frequency * 100)}%`)
      lines.push(`- \`${c.name}\`${c.type ? ` ${c.type}` : ''}${tags.length ? ` [${tags.join(', ')}]` : ''}`)
    }
    if (cols.length > MAX_COLS) lines.push(`- …(${cols.length - MAX_COLS} more columns)`)
  }
  if (objects.length > MAX_TABLES) lines.push('', `…(${objects.length - MAX_TABLES} more ${noun}s not shown)`)
  return lines.join('\n')
}

/**
 * Generate/refresh the tier-1 baseline context from the introspection cache. Guard: never
 * clobbers a tier-2 (repo-derived) doc — if one exists it is marked 'stale' instead, so the user
 * can regenerate it against the changed schema. Best-effort; safe to call after every schema sync.
 */
export async function generateBaselineContext(dataSourceId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return

  const { data: dsRows } = await admin
    .from('data_sources')
    .select('id, org_id, name, engine, repo_id')
    .eq('id', dataSourceId)
    .is('deleted_at', null)
    .limit(1)
  const ds = dsRows?.[0] as
    | { org_id: string; name: string; engine: string; repo_id: string | null }
    | undefined
  if (!ds) return

  // If a repo is CURRENTLY attached, the authoritative context is the tier-2 (code-aware) doc.
  // Don't overwrite it with a schema-only baseline — just flag a fresh one stale so the schema
  // change is visible and the user can regenerate tier-2. (Keyed on the live repo_id, not the
  // context's historical source_repo_id, so detaching a repo lets the baseline take over again.)
  if (ds.repo_id) {
    await admin
      .from('data_source_context')
      .update({ status: 'stale' })
      .eq('data_source_id', dataSourceId)
      .eq('status', 'fresh')
    return
  }

  const { data: schemaRows } = await admin
    .from('data_source_schemas')
    .select('content_hash')
    .eq('data_source_id', dataSourceId)
    .limit(1)
  const schemaHash = (schemaRows?.[0] as { content_hash: string | null } | undefined)?.content_hash ?? null

  const { data: objData } = await admin
    .from('data_source_objects')
    .select('schema_name, object_name, object_type, columns, primary_key')
    .eq('data_source_id', dataSourceId)
    .order('schema_name', { ascending: true })
    .order('object_name', { ascending: true })
  const objects = (objData ?? []) as ObjectRow[]
  if (objects.length === 0) return

  const md = renderBaselineMarkdown(ds.name, ds.engine, objects)
  await putSourceContext({
    dataSourceId,
    orgId: ds.org_id,
    contentMd: md,
    status: 'fresh',
    sourceRepoId: null,
    schemaHash,
  })
}
