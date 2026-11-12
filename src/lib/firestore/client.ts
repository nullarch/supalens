// NOT `import 'server-only'` — runs in the Trigger.dev runtime. Firestore parallel of
// query/pool.ts: build + cache one Firestore client per data source from resolved credentials.
// The client (holding the decrypted private key) lives in THIS parent-process closure and is
// never handed to the model or the agent subprocess (buildChildEnv strips creds) — same custody
// model as the pg pool in executeReadOnly.
import { Firestore } from '@google-cloud/firestore'

import { resolveFirestoreDataSource } from './resolve'

const CACHE_TTL_MS = 5 * 60_000
// A rotated-out client is terminated after a GRACE period, not immediately: a caller that just
// received `hit.db` at the TTL boundary may still be mid-query on it — an instant terminate()
// kills that in-flight read. 60s comfortably exceeds any single Firestore query.
const TERMINATE_GRACE_MS = 60_000
const clients = new Map<string, { db: Firestore; expiresAt: number }>()
// single-flight client creation: N concurrent cold callers (e.g. a dashboard re-running N
// widgets on a cold worker) must share ONE client — last-wins creation leaked N-1 gRPC channels
// per burst into the long-lived Trigger worker (mirrors the installation-token cache).
const inflight = new Map<string, Promise<Firestore>>()

function retireLater(db: Firestore): void {
  const t = setTimeout(() => {
    void db.terminate().catch(() => {})
  }, TERMINATE_GRACE_MS)
  t.unref?.()
}

/** Get a cached Firestore client for a data source, plus its owning org id (for audit). */
export async function getFirestore(dataSourceId: string): Promise<{ db: Firestore; orgId: string }> {
  const { conn, orgId } = await resolveFirestoreDataSource(dataSourceId)

  const hit = clients.get(dataSourceId)
  if (hit && hit.expiresAt > Date.now()) return { db: hit.db, orgId }

  let p = inflight.get(dataSourceId)
  if (!p) {
    p = (async () => {
      // re-check under the flight: a peer may have rotated the client while we awaited resolve
      const cur = clients.get(dataSourceId)
      if (cur && cur.expiresAt > Date.now()) return cur.db
      if (cur) {
        clients.delete(dataSourceId)
        retireLater(cur.db)
      }
      const db = new Firestore({
        projectId: conn.projectId,
        credentials: { client_email: conn.clientEmail, private_key: conn.privateKey },
        databaseId: conn.databaseId,
      })
      clients.set(dataSourceId, { db, expiresAt: Date.now() + CACHE_TTL_MS })
      return db
    })().finally(() => inflight.delete(dataSourceId))
    inflight.set(dataSourceId, p)
  }
  return { db: await p, orgId }
}

/** Terminate + drop a cached client on disconnect/rotation. */
export function closeFirestore(dataSourceId: string): void {
  const hit = clients.get(dataSourceId)
  if (hit) {
    void hit.db.terminate().catch(() => {})
    clients.delete(dataSourceId)
  }
}
