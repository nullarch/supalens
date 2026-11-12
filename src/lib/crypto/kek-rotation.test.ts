import { randomBytes } from 'crypto'

import { afterEach, describe, expect, it } from 'vitest'

import { getKekProvider } from './kek'

/**
 * KEK rotation invariant: after swapping KEK_LOCAL_MASTER_KEY, ciphertexts wrapped
 * under the OLD key must still unwrap while KEK_LOCAL_MASTER_KEY_PREVIOUS is set
 * (the re-wrap window), and must fail once the previous key is removed.
 *
 * getKekProvider caches per-process, so each scenario is isolated via vi.resetModules
 * — instead we import fresh instances through dynamic import with a cache-busted env.
 */

const oldKey = randomBytes(32).toString('base64')
const newKey = randomBytes(32).toString('base64')

async function freshProvider(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  // bust the module-level provider cache
  const { vi } = await import('vitest')
  vi.resetModules()
  const mod = await import('./kek')
  return mod.getKekProvider()
}

afterEach(() => {
  delete process.env.KEK_LOCAL_MASTER_KEY
  delete process.env.KEK_LOCAL_MASTER_KEY_PREVIOUS
  delete process.env.KEK_PROVIDER
})

describe('local KEK rotation', () => {
  it('round-trips under a single key', async () => {
    const kek = await freshProvider({ KEK_PROVIDER: 'local', KEK_LOCAL_MASTER_KEY: oldKey, KEK_LOCAL_MASTER_KEY_PREVIOUS: undefined })
    const dek = randomBytes(32)
    const wrapped = await kek.wrap(dek)
    expect((await kek.unwrap(wrapped)).equals(dek)).toBe(true)
  })

  it('unwraps old-key ciphertext via the previous-key fallback during rotation', async () => {
    const kekOld = await freshProvider({ KEK_PROVIDER: 'local', KEK_LOCAL_MASTER_KEY: oldKey, KEK_LOCAL_MASTER_KEY_PREVIOUS: undefined })
    const dek = randomBytes(32)
    const wrappedUnderOld = await kekOld.wrap(dek)

    const kekRotating = await freshProvider({
      KEK_PROVIDER: 'local',
      KEK_LOCAL_MASTER_KEY: newKey,
      KEK_LOCAL_MASTER_KEY_PREVIOUS: oldKey,
    })
    expect((await kekRotating.unwrap(wrappedUnderOld)).equals(dek)).toBe(true)
    // and new wraps use the new key: unwrappable without the previous key
    const rewrapped = await kekRotating.wrap(dek)
    const kekFinal = await freshProvider({
      KEK_PROVIDER: 'local',
      KEK_LOCAL_MASTER_KEY: newKey,
      KEK_LOCAL_MASTER_KEY_PREVIOUS: undefined,
    })
    expect((await kekFinal.unwrap(rewrapped)).equals(dek)).toBe(true)
  })

  it('fails on old-key ciphertext once the previous key is removed', async () => {
    const kekOld = await freshProvider({ KEK_PROVIDER: 'local', KEK_LOCAL_MASTER_KEY: oldKey, KEK_LOCAL_MASTER_KEY_PREVIOUS: undefined })
    const wrappedUnderOld = await kekOld.wrap(randomBytes(32))
    const kekFinal = await freshProvider({
      KEK_PROVIDER: 'local',
      KEK_LOCAL_MASTER_KEY: newKey,
      KEK_LOCAL_MASTER_KEY_PREVIOUS: undefined,
    })
    await expect(kekFinal.unwrap(wrappedUnderOld)).rejects.toThrow()
  })
})

// keep TS happy that the static import is used (the real instances come from dynamic imports)
void getKekProvider
