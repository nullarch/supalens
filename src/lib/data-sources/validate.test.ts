import { describe, expect, it } from 'vitest'

import { parseDirectDataSourceInput } from './validate'

const base = { name: 'db', engine: 'postgres', host: 'db.example.com', port: 5432, database: 'app', user: 'u', password: 'p' }

describe('parseDirectDataSourceInput', () => {
  it('accepts a valid payload', () => {
    const r = parseDirectDataSourceInput(base)
    expect(r.ok).toBe(true)
  })
  it('coerces port string and defaults ssl/provider', () => {
    const r = parseDirectDataSourceInput({ ...base, port: '6543' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.port).toBe(6543)
      expect(r.value.ssl).toBe(false)
      expect(r.value.provider).toBe('self_hosted')
    }
  })
  it('rejects an unknown engine', () => {
    expect(parseDirectDataSourceInput({ ...base, engine: 'oracle' }).ok).toBe(false)
  })
  it('rejects empty host', () => {
    expect(parseDirectDataSourceInput({ ...base, host: '' }).ok).toBe(false)
  })
  it('rejects out-of-range port', () => {
    expect(parseDirectDataSourceInput({ ...base, port: 99999 }).ok).toBe(false)
  })
  it('rejects missing password', () => {
    const { password: _omit, ...noPw } = base
    void _omit
    expect(parseDirectDataSourceInput(noPw).ok).toBe(false)
  })
})
