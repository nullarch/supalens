// Shared with the Trigger.dev agent runtime — no `import 'server-only'` (it throws in a
// plain Node bundle). Safe: needs the service-role admin client + KMS, server-only by nature.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto'

import { requireAdminClient } from '@/utils/supabase/admin'
import { getKekProvider } from './kek'

/**
 * Envelope encryption for the secrets vault.
 *
 *   plaintext --AES-256-GCM(DEK, nonce, AAD)--> ciphertext   (per secret)
 *   DEK       --wrap(KEK)----------------------> wrapped_dek  (per tenant, in data_encryption_keys)
 *
 * AAD binds each ciphertext to its row: AAD = id || org_id || kind || dek_id.
 * Moving/cut-and-pasting a ciphertext into another row makes the GCM tag fail.
 */

const ALGO = 'aes-256-gcm'
const AAD_VERSION = 1

// process-lifetime caches of UNWRAPPED DEKs (plaintext key material in memory is
// expected for envelope encryption; never persisted, never logged).
const dekByOrg = new Map<string, { dekId: string; dek: Buffer }>()
const dekById = new Map<string, Buffer>()

function buildAad(p: { secretId: string; orgId: string; kind: string; dekId: string; aadVersion: number }): Buffer {
  // canonical, unambiguous join (unit separator) + version prefix.
  // orgId/secretId are normalized (Postgres returns uuid columns lowercased) so the
  // encrypt-time and decrypt-time AAD are byte-identical regardless of caller casing.
  const orgId = p.orgId.trim().toLowerCase()
  const secretId = p.secretId.trim().toLowerCase()
  return Buffer.from(`v${p.aadVersion}\x1f${secretId}\x1f${orgId}\x1f${p.kind}\x1f${p.dekId}`, 'utf8')
}

async function getOrCreateOrgDek(orgId: string): Promise<{ dekId: string; dek: Buffer }> {
  const hit = dekByOrg.get(orgId)
  if (hit) return hit

  const admin = requireAdminClient()
  const kek = getKekProvider()

  const { data: existing, error } = await admin
    .from('data_encryption_keys')
    .select('id, wrapped_dek')
    .eq('org_id', orgId)
    .eq('state', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error

  if (existing && existing.length > 0) {
    const row = existing[0] as { id: string; wrapped_dek: string }
    const dek = await kek.unwrap(row.wrapped_dek)
    const entry = { dekId: row.id, dek }
    dekByOrg.set(orgId, entry)
    dekById.set(row.id, dek)
    return entry
  }

  // create a fresh per-tenant DEK
  const dek = randomBytes(32)
  const wrapped = await kek.wrap(dek)
  const dekId = `dek_${orgId}_${randomUUID()}`

  const { error: insErr } = await admin.from('data_encryption_keys').insert({
    id: dekId,
    org_id: orgId,
    wrapped_dek: wrapped,
    kek_provider: kek.name,
    kek_uri: kek.kekUri,
    algo: ALGO,
    state: 'active',
  })
  if (insErr) {
    // possible race: another request created the active DEK first — re-read
    dekByOrg.delete(orgId)
    const { data: retry } = await admin
      .from('data_encryption_keys')
      .select('id, wrapped_dek')
      .eq('org_id', orgId)
      .eq('state', 'active')
      .limit(1)
    if (retry && retry.length > 0) {
      const row = retry[0] as { id: string; wrapped_dek: string }
      const existingDek = await kek.unwrap(row.wrapped_dek)
      const entry = { dekId: row.id, dek: existingDek }
      dekByOrg.set(orgId, entry)
      dekById.set(row.id, existingDek)
      return entry
    }
    throw insErr
  }

  const entry = { dekId, dek }
  dekByOrg.set(orgId, entry)
  dekById.set(dekId, dek)
  return entry
}

async function getDekById(dekId: string): Promise<Buffer> {
  const hit = dekById.get(dekId)
  if (hit) return hit

  const admin = requireAdminClient()
  const kek = getKekProvider()
  const { data, error } = await admin
    .from('data_encryption_keys')
    .select('wrapped_dek, state')
    .eq('id', dekId)
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`DEK not found: ${dekId}`)
  const row = data[0] as { wrapped_dek: string; state: string }
  if (row.state === 'destroyed') throw new Error(`DEK has been crypto-shredded: ${dekId}`)

  const dek = await kek.unwrap(row.wrapped_dek)
  dekById.set(dekId, dek)
  return dek
}

export interface EncryptedPayload {
  ciphertext: string // base64 (ct || tag)
  nonce: string // base64 (12 bytes)
  dekId: string
  algo: string
  aadVersion: number
}

/**
 * Encrypt a secret value for a given pre-allocated secret id.
 * The caller MUST insert the secret row using the same `secretId` so the AAD matches.
 */
export async function encryptSecret(args: {
  secretId: string
  orgId: string
  kind: string
  plaintext: string | Buffer
}): Promise<EncryptedPayload> {
  const { dekId, dek } = await getOrCreateOrgDek(args.orgId)
  const nonce = randomBytes(12)
  const aad = buildAad({ secretId: args.secretId, orgId: args.orgId, kind: args.kind, dekId, aadVersion: AAD_VERSION })

  const cipher = createCipheriv(ALGO, dek, nonce, { authTagLength: 16 })
  cipher.setAAD(aad)
  const data = typeof args.plaintext === 'string' ? Buffer.from(args.plaintext, 'utf8') : args.plaintext
  const ct = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    ciphertext: Buffer.concat([ct, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
    dekId,
    algo: ALGO,
    aadVersion: AAD_VERSION,
  }
}

/** Decrypt a secret value. Throws if the row was tampered/moved (AAD mismatch). */
export async function decryptSecret(args: {
  secretId: string
  orgId: string
  kind: string
  dekId: string
  ciphertext: string
  nonce: string
  aadVersion: number
}): Promise<Buffer> {
  const dek = await getDekById(args.dekId)
  const aad = buildAad({
    secretId: args.secretId,
    orgId: args.orgId,
    kind: args.kind,
    dekId: args.dekId,
    aadVersion: args.aadVersion,
  })

  const raw = Buffer.from(args.ciphertext, 'base64')
  const tag = raw.subarray(raw.length - 16)
  const ct = raw.subarray(0, raw.length - 16)
  const nonce = Buffer.from(args.nonce, 'base64')

  const decipher = createDecipheriv(ALGO, dek, nonce, { authTagLength: 16 })
  decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

/** Forget cached plaintext DEKs (e.g. after crypto-shred). Mostly for tests. */
export function clearDekCache() {
  dekByOrg.clear()
  dekById.clear()
}
