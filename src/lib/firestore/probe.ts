// NOT `import 'server-only'` — used by registration (server) to test raw creds before insert.
// Firestore parallel of data-sources/test-connection.ts: build a THROWAWAY client from the
// supplied credentials, do a trivial read (listCollections), and terminate — so a failed probe
// never pollutes the long-lived per-data-source client cache.
import { Firestore } from '@google-cloud/firestore'

import type { FirestoreConnection } from './resolve'

export async function probeFirestore(
  conn: FirestoreConnection
): Promise<{ ok: boolean; error?: string; collections?: number; latencyMs?: number }> {
  const start = Date.now()
  const db = new Firestore({
    projectId: conn.projectId,
    credentials: { client_email: conn.clientEmail, private_key: conn.privateKey },
    databaseId: conn.databaseId,
  })
  try {
    const cols = await db.listCollections()
    return { ok: true, collections: cols.length, latencyMs: Date.now() - start }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }
  } finally {
    void db.terminate().catch(() => {})
  }
}
