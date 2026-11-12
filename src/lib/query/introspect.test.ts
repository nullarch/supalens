import { describe, expect, it } from 'vitest'

import { rlsSchemaNote, type SchemaTable } from './introspect'

const t = (schema: string, table: string, rlsEnabled?: boolean): SchemaTable => ({
  schema,
  table,
  rlsEnabled,
  columns: [{ name: 'id', type: 'integer', nullable: false }],
})

describe('rlsSchemaNote', () => {
  it('is empty when no table has RLS (no false alarm)', () => {
    expect(rlsSchemaNote([t('public', 'orders'), t('public', 'items', false)])).toBe('')
    expect(rlsSchemaNote([])).toBe('')
  })

  it('warns when any table has RLS enabled', () => {
    const note = rlsSchemaNote([t('public', 'plain', false), t('public', 'orders', true)])
    expect(note).toMatch(/row-level security/i)
    expect(note).toMatch(/do NOT conclude the table is empty/i)
    // note is a prefix (ends with a separator) so it reads before the JSON schema
    expect(note.endsWith('\n\n')).toBe(true)
  })
})
