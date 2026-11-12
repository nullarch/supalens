import { randomBytes } from 'crypto'

import { beforeAll, describe, expect, it } from 'vitest'

describe('local KEK provider', () => {
  beforeAll(() => {
    process.env.KEK_PROVIDER = 'local'
    process.env.KEK_LOCAL_MASTER_KEY = randomBytes(32).toString('base64')
  })

  it('wraps and unwraps a DEK round-trip', async () => {
    const { getKekProvider } = await import('./kek')
    const kek = getKekProvider()
    const dek = randomBytes(32)
    const wrapped = await kek.wrap(dek)
    expect(wrapped).not.toBe(dek.toString('base64')) // actually encrypted
    const back = await kek.unwrap(wrapped)
    expect(back.equals(dek)).toBe(true)
  })

  it('rejects a tampered wrapped DEK (GCM auth)', async () => {
    const { getKekProvider } = await import('./kek')
    const kek = getKekProvider()
    const wrapped = await kek.wrap(randomBytes(32))
    const buf = Buffer.from(wrapped, 'base64')
    buf[buf.length - 1] ^= 0xff // flip a tag byte
    await expect(kek.unwrap(buf.toString('base64'))).rejects.toBeTruthy()
  })
})
