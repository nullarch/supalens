import { describe, expect, it } from 'vitest'

import { _internal, assertSafeHost, UnsafeHostError } from './ssrf'

describe('SSRF address classification', () => {
  const blocked = [
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.10',
    '172.16.5.5',
    '172.31.255.255',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '224.0.0.1', // multicast
  ]
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1']

  for (const ip of blocked) it(`blocks v4 ${ip}`, () => expect(_internal.isBlocked(ip)).toBe(true))
  for (const ip of allowed) it(`allows v4 ${ip}`, () => expect(_internal.isBlocked(ip)).toBe(false))

  it('blocks v6 loopback / unique-local / link-local', () => {
    expect(_internal.isBlocked('::1')).toBe(true)
    expect(_internal.isBlocked('fd00::1')).toBe(true)
    expect(_internal.isBlocked('fe80::1')).toBe(true)
  })
  it('blocks v4-mapped v6 — dotted AND hex forms', () => {
    expect(_internal.isBlocked('::ffff:127.0.0.1')).toBe(true)
    expect(_internal.isBlocked('::ffff:7f00:1')).toBe(true) // 127.0.0.1 in hex
    expect(_internal.isBlocked('::ffff:0a00:0005')).toBe(true) // 10.0.0.5
    expect(_internal.isBlocked('::ffff:a9fe:a9fe')).toBe(true) // 169.254.169.254 metadata
    expect(_internal.isBlocked('::127.0.0.1')).toBe(true) // v4-compatible
    expect(_internal.isBlocked('64:ff9b::a9fe:a9fe')).toBe(true) // NAT64 → metadata
  })
  it('allows public IPv6', () => {
    expect(_internal.isBlocked('2606:4700:4700::1111')).toBe(false)
  })
})

describe('assertSafeHost', () => {
  it('rejects loopback IP literal', async () => {
    await expect(assertSafeHost('127.0.0.1')).rejects.toBeInstanceOf(UnsafeHostError)
  })
  it('rejects the cloud metadata IP', async () => {
    await expect(assertSafeHost('169.254.169.254')).rejects.toBeInstanceOf(UnsafeHostError)
  })
  it('rejects localhost (resolves to loopback)', async () => {
    await expect(assertSafeHost('localhost')).rejects.toBeInstanceOf(UnsafeHostError)
  })
  it('allows a public IP literal', async () => {
    await expect(assertSafeHost('1.1.1.1')).resolves.toBeUndefined()
  })
  it('honors ALLOW_PRIVATE_DB_HOSTS', async () => {
    process.env.ALLOW_PRIVATE_DB_HOSTS = 'true'
    try {
      await expect(assertSafeHost('127.0.0.1')).resolves.toBeUndefined()
    } finally {
      delete process.env.ALLOW_PRIVATE_DB_HOSTS
    }
  })
})
