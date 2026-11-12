// Shared with the Trigger.dev agent runtime — no `import 'server-only'` (it throws in a
// plain Node bundle). Safe: needs KEK_* / KMS env that is never shipped to the browser.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Key-Encryption-Key (KEK) provider.
 *
 * The KEK wraps per-tenant Data-Encryption-Keys (DEK). In production the KEK must
 * live in an external KMS reachable only by a *separate* IAM identity that the
 * Postgres/service-role does NOT hold — so a leaked DB or service-role key cannot
 * unwrap a DEK. `wrap`/`unwrap` are therefore async (an API call), not a column read.
 *
 * Two providers:
 *   - 'local' : dev-only. Wraps with an AES-256-GCM master key from env. Do NOT use in prod.
 *   - 'gcp_kms': production. Delegates wrap/unwrap to a Cloud KMS key.
 */
export interface KekProvider {
  readonly name: 'local' | 'gcp_kms'
  /** Resource identifier of the KEK (stored alongside the wrapped DEK). */
  readonly kekUri: string
  /** Wrap a plaintext DEK. Returns base64 ciphertext. */
  wrap(plainDek: Buffer): Promise<string>
  /** Unwrap a base64-wrapped DEK back to plaintext. */
  unwrap(wrappedB64: string): Promise<Buffer>
}

// ---- local (dev) provider: AES-256-GCM with an env master key -------------
class LocalKekProvider implements KekProvider {
  readonly name = 'local' as const
  readonly kekUri = 'local'
  #master: Buffer
  /** previous master key (rotation window): unwrap falls back to it on auth failure */
  #previous: Buffer | null

  constructor(masterKeyB64: string, previousKeyB64?: string) {
    const key = Buffer.from(masterKeyB64, 'base64')
    if (key.length !== 32) {
      throw new Error('KEK_LOCAL_MASTER_KEY must be base64 of exactly 32 bytes (256-bit).')
    }
    this.#master = key
    if (previousKeyB64) {
      const prev = Buffer.from(previousKeyB64, 'base64')
      if (prev.length !== 32) throw new Error('KEK_LOCAL_MASTER_KEY_PREVIOUS must be base64 of exactly 32 bytes.')
      this.#previous = prev
    } else {
      this.#previous = null
    }
  }

  async wrap(plainDek: Buffer): Promise<string> {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.#master, iv)
    const ct = Buffer.concat([cipher.update(plainDek), cipher.final()])
    const tag = cipher.getAuthTag()
    // layout: iv(12) || tag(16) || ciphertext
    return Buffer.concat([iv, tag, ct]).toString('base64')
  }

  async unwrap(wrappedB64: string): Promise<Buffer> {
    const buf = Buffer.from(wrappedB64, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const ct = buf.subarray(28)
    const tryKey = (key: Buffer): Buffer => {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ct), decipher.final()])
    }
    try {
      return tryKey(this.#master)
    } catch (err) {
      // rotation window: DEKs not yet re-wrapped were wrapped with the previous key
      if (this.#previous) return tryKey(this.#previous)
      throw err
    }
  }
}

// ---- gcp_kms (prod) provider ----------------------------------------------
// Lazily loads @google-cloud/kms via a runtime specifier so the package is only
// required when actually used in production (install it before enabling).
interface KmsClient {
  encrypt(req: { name: string; plaintext: Buffer }): Promise<[{ ciphertext: Buffer | Uint8Array }]>
  decrypt(req: { name: string; ciphertext: Buffer }): Promise<[{ plaintext: Buffer | Uint8Array }]>
}

class GcpKmsKekProvider implements KekProvider {
  readonly name = 'gcp_kms' as const
  readonly kekUri: string
  #clientPromise: Promise<KmsClient> | null = null

  constructor(keyName: string) {
    this.kekUri = keyName // projects/*/locations/*/keyRings/*/cryptoKeys/*
  }

  #client(): Promise<KmsClient> {
    if (!this.#clientPromise) {
      const specifier = '@google-cloud/kms'
      this.#clientPromise = import(/* webpackIgnore: true */ specifier).then((mod) => {
        const Ctor = (mod as { KeyManagementServiceClient: new () => KmsClient }).KeyManagementServiceClient
        return new Ctor()
      })
    }
    return this.#clientPromise
  }

  async wrap(plainDek: Buffer): Promise<string> {
    const client = await this.#client()
    const [res] = await client.encrypt({ name: this.kekUri, plaintext: plainDek })
    return Buffer.from(res.ciphertext).toString('base64')
  }

  async unwrap(wrappedB64: string): Promise<Buffer> {
    const client = await this.#client()
    const [res] = await client.decrypt({ name: this.kekUri, ciphertext: Buffer.from(wrappedB64, 'base64') })
    return Buffer.from(res.plaintext)
  }
}

// ---- selection -------------------------------------------------------------
let cached: KekProvider | null = null

export function getKekProvider(): KekProvider {
  if (cached) return cached

  const provider = process.env.KEK_PROVIDER ?? 'local'

  if (provider === 'gcp_kms') {
    const keyName = process.env.KEK_GCP_KEY
    if (!keyName) throw new Error('KEK_PROVIDER=gcp_kms requires KEK_GCP_KEY (Cloud KMS key resource name).')
    cached = new GcpKmsKekProvider(keyName)
  } else if (provider === 'local') {
    const master = process.env.KEK_LOCAL_MASTER_KEY
    if (!master) {
      throw new Error(
        'KEK_PROVIDER=local requires KEK_LOCAL_MASTER_KEY (base64 of 32 random bytes). ' +
          'Generate with: openssl rand -base64 32'
      )
    }
    cached = new LocalKekProvider(master, process.env.KEK_LOCAL_MASTER_KEY_PREVIOUS)
  } else {
    throw new Error(`Unknown KEK_PROVIDER: ${provider}`)
  }

  return cached
}
