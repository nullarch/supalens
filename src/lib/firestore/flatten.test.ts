import { Timestamp, GeoPoint } from '@google-cloud/firestore'
import { describe, it, expect } from 'vitest'

import { flattenDocuments, FIRESTORE_ID_COLUMN } from './flatten'

describe('flattenDocuments', () => {
  it('surfaces the document id first, as __id', () => {
    const { columns, rows } = flattenDocuments([{ id: 'abc', data: { name: 'x' } }])
    expect(columns[0]).toBe(FIRESTORE_ID_COLUMN)
    expect(rows[0][FIRESTORE_ID_COLUMN]).toBe('abc')
  })

  it('flattens nested objects with dot notation', () => {
    const { columns, rows } = flattenDocuments([{ id: '1', data: { address: { city: 'Seoul', geo: { lat: 37 } } } }])
    expect(columns).toContain('address.city')
    expect(columns).toContain('address.geo.lat')
    expect(rows[0]['address.city']).toBe('Seoul')
    expect(rows[0]['address.geo.lat']).toBe(37)
  })

  it('serializes arrays to JSON strings (not expanded into columns)', () => {
    const { rows } = flattenDocuments([{ id: '1', data: { tags: ['a', 'b'] } }])
    expect(rows[0].tags).toBe('["a","b"]')
  })

  it('converts Firestore Timestamp and JS Date to ISO strings', () => {
    const d = new Date('2026-07-02T00:00:00.000Z')
    const { rows } = flattenDocuments([{ id: '1', data: { created: Timestamp.fromDate(d), updated: d } }])
    expect(rows[0].created).toBe('2026-07-02T00:00:00.000Z')
    expect(rows[0].updated).toBe('2026-07-02T00:00:00.000Z')
  })

  it('renders a GeoPoint as "lat,lng" but does NOT mistake a plain lat/lng map for one', () => {
    const { columns, rows } = flattenDocuments([
      { id: '1', data: { loc: new GeoPoint(37.5, 127), coords: { latitude: 1, longitude: 2 } } },
    ])
    expect(rows[0].loc).toBe('37.5,127')
    expect(columns).toContain('coords.latitude')
    expect(rows[0]['coords.latitude']).toBe(1)
    expect(rows[0]['coords.longitude']).toBe(2)
  })

  it('unions columns across heterogeneous docs and fills missing fields with null', () => {
    const { columns, rows } = flattenDocuments([
      { id: '1', data: { a: 1 } },
      { id: '2', data: { b: 2 } },
    ])
    expect(columns).toEqual(expect.arrayContaining([FIRESTORE_ID_COLUMN, 'a', 'b']))
    expect(rows[0].b).toBeNull()
    expect(rows[1].a).toBeNull()
  })

  it('preserves null and boolean primitives', () => {
    const { rows } = flattenDocuments([{ id: '1', data: { active: true, deleted: null } }])
    expect(rows[0].active).toBe(true)
    expect(rows[0].deleted).toBeNull()
  })

  it('never lets a user field named __id overwrite the reserved document-id column', () => {
    const { columns, rows } = flattenDocuments([{ id: 'doc-1', data: { __id: 'user-value', a: 1 } }])
    expect(rows[0][FIRESTORE_ID_COLUMN]).toBe('doc-1') // the doc id survives
    expect(columns).toContain('__id_') // the user field is remapped, not dropped
    expect(rows[0].__id_).toBe('user-value')
  })
})
