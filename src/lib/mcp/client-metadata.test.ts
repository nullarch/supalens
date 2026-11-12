import { describe, expect, it, vi } from 'vitest'

import {
  ClientMetadataError,
  fetchClientMetadata,
  isPublicAddress,
  parseClientIdUrl,
  redirectUriAllowed,
  validateClientMetadata,
} from './client-metadata'

/**
 * A Client ID Metadata Document is the one place the server requests an address a stranger chose
 * (the `client_id` on the consent URL). These pin the checks that run before any byte is sent,
 * and the redirect-URI rule that decides where an authorization code may be delivered.
 */
const ID = 'https://client.example/oauth/metadata.json'
const doc = (over: Record<string, unknown> = {}) => ({
  client_id: ID,
  client_name: 'Example',
  redirect_uris: ['https://client.example/callback', 'http://localhost/callback'],
  ...over,
})

describe('client_id URL', () => {
  it('accepts an https URL with a path', () => {
    expect(parseClientIdUrl(ID).hostname).toBe('client.example')
  })
  it.each([
    'http://client.example/meta',
    'https://client.example/',
    'https://user:pw@client.example/meta',
    'https://client.example/meta#frag',
    'https://127.0.0.1/meta',
    'https://[::1]/meta',
    'not a url',
  ])('rejects %s', (raw) => {
    expect(() => parseClientIdUrl(raw)).toThrow(ClientMetadataError)
  })
})

describe('address checks', () => {
  it.each(['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '64:ff9b::a00:1'])(
    'blocks %s',
    (address) => expect(isPublicAddress(address)).toBe(false),
  )
  it.each(['8.8.8.8', '160.79.104.10', '2606:4700::1111'])('allows %s', (address) =>
    expect(isPublicAddress(address)).toBe(true),
  )
})

describe('redirect URIs', () => {
  const registered = ['https://client.example/callback', 'http://localhost/callback']
  it('matches exactly', () => {
    expect(redirectUriAllowed('https://client.example/callback', registered)).toBe(true)
    expect(redirectUriAllowed('https://client.example/callback/extra', registered)).toBe(false)
    expect(redirectUriAllowed('https://evil.example/callback', registered)).toBe(false)
  })
  it('lets a native client use any loopback port, and nothing else', () => {
    expect(redirectUriAllowed('http://localhost:53124/callback', registered)).toBe(true)
    expect(redirectUriAllowed('http://localhost:53124/other', registered)).toBe(false)
    expect(redirectUriAllowed('http://127.0.0.1:53124/callback', registered)).toBe(false)
    expect(redirectUriAllowed('https://client.example:8443/callback', registered)).toBe(false)
  })
})

describe('metadata document', () => {
  it('accepts a public client and keeps its redirect URIs', () => {
    expect(validateClientMetadata(ID, doc())).toEqual({
      clientId: ID,
      clientName: 'Example',
      redirectUris: ['https://client.example/callback', 'http://localhost/callback'],
    })
  })
  it.each([
    ['a different client_id', doc({ client_id: 'https://other.example/meta' })],
    ['no redirect_uris', doc({ redirect_uris: [] })],
    ['plain http off loopback', doc({ redirect_uris: ['http://client.example/callback'] })],
    ['a javascript: redirect', doc({ redirect_uris: ['javascript:alert(1)'] })],
    ['a confidential client', doc({ token_endpoint_auth_method: 'client_secret_basic' })],
    ['a non-object', 'nope'],
  ])('rejects %s', (_label, value) => {
    expect(() => validateClientMetadata(ID, value)).toThrow(ClientMetadataError)
  })
})

describe('fetching', () => {
  const ok = () => vi.fn(async () => new Response(JSON.stringify(doc({ client_id: 'https://a.example/m' })), { status: 200 }))

  it('never requests a host that resolves to a private address', async () => {
    const fetchImpl = ok()
    await expect(
      fetchClientMetadata('https://a.example/m', { resolve: async () => ['8.8.8.8', '10.0.0.1'], fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/non-public/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fetches without following redirects and validates the answer', async () => {
    const fetchImpl = ok()
    const got = await fetchClientMetadata('https://a.example/m', { resolve: async () => ['8.8.8.8'], fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(got.clientId).toBe('https://a.example/m')
    expect((fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1].redirect).toBe('error')
  })

  it('refuses a document that is too large or not 200', async () => {
    const big = vi.fn(async () => new Response('x'.repeat(70_000), { status: 200 }))
    await expect(
      fetchClientMetadata('https://b.example/m', { resolve: async () => ['8.8.8.8'], fetchImpl: big as unknown as typeof fetch }),
    ).rejects.toThrow(/too large/)
    const missing = vi.fn(async () => new Response('', { status: 404 }))
    await expect(
      fetchClientMetadata('https://c.example/m', { resolve: async () => ['8.8.8.8'], fetchImpl: missing as unknown as typeof fetch }),
    ).rejects.toThrow(/404/)
  })
})
