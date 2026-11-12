// NOT `import 'server-only'` — usable from the Trigger runtime and the Vercel BFF alike
// (mirrors src/lib/query/* and src/lib/firestore/*, which the agent host also imports).
//
// Populates the (previously dormant) schema-introspection cache:
//   data_source_schemas  — 1 row / source (status, synced_at, object_count, content_hash)
//   data_source_objects  — 1 row / table|collection (columns, primary_key, …)
// Reads are member-scoped (dss_sel/dso_sel RLS); writes are service_role-only, so this uses
// the admin client. It reuses the SAME introspection the agent's get_schema tools use
// (query/introspect.getSchema for SQL, firestore/introspect for documents) so the cache never
// diverges from what the agent sees.
import { createHash } from 'crypto'

import { requireAdminClient } from '@/utils/supabase/admin'
import { getSchema } from '@/lib/query/introspect'
import { listCollections, inferCollectionSchema } from '@/lib/firestore/introspect'
import { isDocumentEngine, isSqlEngine } from '@/lib/data-sources/engines'
import { generateBaselineContext } from '@/lib/context/baseline'

interface CachedObject {
  schema_name: string
  object_name: string
  object_type: string
  columns: unknown
  primary_key: string[] | null
}

// Firestore introspection samples docs per collection (billed reads) — bound the fan-out.
const MAX_FIRESTORE_COLLECTIONS = 200

async function introspectSql(dataSourceId: string): Promise<CachedObject[]> {
  const tables = await getSchema(dataSourceId)
  return tables.map((t) => ({
    schema_name: t.schema,
    object_name: t.table,
    object_type: 'table',
    columns: t.columns, // [{ name, type, nullable }]
    primary_key: null,
  }))
}

async function introspectFirestore(dataSourceId: string, databaseId: string): Promise<CachedObject[]> {
  const collections = (await listCollections(dataSourceId)).slice(0, MAX_FIRESTORE_COLLECTIONS)
  const out: CachedObject[] = []
  for (const c of collections) {
    const schema = await inferCollectionSchema(dataSourceId, c)
    out.push({
      schema_name: databaseId || '(default)',
      object_name: c,
      object_type: 'collection',
      columns: schema.fields.map((f) => ({
        name: f.name,
        type: f.types.join('|'),
        nullable: f.types.includes('null'),
        frequency: f.frequency,
      })),
      primary_key: ['__id'],
    })
  }
  return out
}

/** Stable hash of the introspected shape — lets Phase 4 detect schema drift cheaply. */
function hashObjects(objs: CachedObject[]): string {
  const norm = objs
    .map((o) => `${o.schema_name}.${o.object_name}:${JSON.stringify(o.columns)}`)
    .sort()
    .join('\n')
  return createHash('sha256').update(norm).digest('hex')
}

/**
 * Introspect a data source's structure and cache it. Idempotent: marks status='syncing',
 * replaces the object rows, then marks 'fresh' (or 'failed' + error on throw). Called
 * best-effort at connect time (never fails registration) and on demand via
 * POST /api/data-sources/[id]/introspect.
 */
export async function syncSchemaCache(dataSourceId: string): Promise<{ objectCount: number }> {
  const admin = requireAdminClient()

  const { data: rows } = await admin
    .from('data_sources')
    .select('id, engine, config')
    .eq('id', dataSourceId)
    .is('deleted_at', null)
    .limit(1)
  const ds = rows?.[0] as { engine: string; config: Record<string, unknown> | null } | undefined
  if (!ds) throw new Error('data source not found')

  await admin
    .from('data_source_schemas')
    .upsert({ data_source_id: dataSourceId, status: 'syncing', error: null }, { onConflict: 'data_source_id' })

  try {
    // whitelist per engine family — an unknown engine fails the sync with a clear error
    // instead of running SQL introspection against a non-SQL source
    let objects: CachedObject[]
    if (isDocumentEngine(ds.engine)) {
      objects = await introspectFirestore(dataSourceId, String(ds.config?.database_id ?? '(default)'))
    } else if (isSqlEngine(ds.engine)) {
      objects = await introspectSql(dataSourceId)
    } else {
      throw new Error(`no introspection registered for engine "${ds.engine}"`)
    }

    // Replace the object set (delete-then-insert; the whole sync is one source's rows).
    await admin.from('data_source_objects').delete().eq('data_source_id', dataSourceId)
    if (objects.length) {
      await admin.from('data_source_objects').insert(
        objects.map((o) => ({
          data_source_id: dataSourceId,
          schema_name: o.schema_name,
          object_name: o.object_name,
          object_type: o.object_type,
          columns: o.columns,
          primary_key: o.primary_key,
          introspected_at: new Date().toISOString(),
        }))
      )
    }

    await admin.from('data_source_schemas').upsert(
      {
        data_source_id: dataSourceId,
        status: 'fresh',
        synced_at: new Date().toISOString(),
        object_count: objects.length,
        content_hash: hashObjects(objects),
        error: null,
      },
      { onConflict: 'data_source_id' }
    )

    // Refresh the tier-1 baseline context doc so it's injected into the agent immediately.
    // (Guarded inside: won't clobber a repo-derived tier-2 doc — that gets marked 'stale'.)
    try {
      await generateBaselineContext(dataSourceId)
    } catch (e) {
      console.error(`[data-sources] baseline context generation failed for ${dataSourceId}`, e)
    }

    return { objectCount: objects.length }
  } catch (e) {
    await admin.from('data_source_schemas').upsert(
      { data_source_id: dataSourceId, status: 'failed', error: String(e).slice(0, 300) },
      { onConflict: 'data_source_id' }
    )
    throw e
  }
}
