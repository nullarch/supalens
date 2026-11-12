import { describe, expect, it } from 'vitest'

import { resolveWidgetSource, sourceMarkOf, type WidgetSource } from './widget-source'

describe('sourceMarkOf', () => {
  it('draws Supabase by provider, the rest by engine', () => {
    expect(sourceMarkOf({ engine: 'postgres', provider: 'supabase' })).toBe('supabase')
    expect(sourceMarkOf({ engine: 'postgres', provider: 'direct' })).toBe('postgresql')
    expect(sourceMarkOf({ engine: 'mysql', provider: 'direct' })).toBe('mysql')
    expect(sourceMarkOf({ engine: 'firestore', provider: 'firebase' })).toBe('firestore')
    expect(sourceMarkOf({ engine: 'bigquery', provider: null })).toBe('postgresql')
  })
})

describe('resolveWidgetSource', () => {
  const acme: WidgetSource = { id: 's1', name: 'acme-prod', engine: 'supabase' }
  const sources = new Map([[acme.id, acme]])

  it('names the source a widget reads from', () => {
    expect(resolveWidgetSource('s1', sources)).toBe(acme)
  })

  it('says "no source" only for a widget that really has none', () => {
    expect(resolveWidgetSource(null, sources)).toBeNull()
    expect(resolveWidgetSource(null, null)).toBeNull()
  })

  it('never guesses a source it could not read', () => {
    expect(resolveWidgetSource('s9', sources)).toBeUndefined()
    expect(resolveWidgetSource('s1', null)).toBeUndefined()
  })
})
