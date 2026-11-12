import { describe, expect, it } from 'vitest'

import { parseConnectionString } from './connection-string'

describe('parseConnectionString', () => {
  it('splits a Postgres URL into fields and decodes credentials', () => {
    expect(parseConnectionString('postgresql://report%40ro:p%40ss%2Fword@db.internal:6543/app_prod?sslmode=require', 'postgres')).toEqual({
      host: 'db.internal', port: '6543', database: 'app_prod', user: 'report@ro', password: 'p@ss/word', ssl: 'require',
    })
  })

  it('defaults the port and verifies certificates unless the URL says otherwise', () => {
    expect(parseConnectionString('postgres://ro:x@10.0.0.5/app', 'postgres')).toMatchObject({ port: '5432', ssl: 'verify' })
    expect(parseConnectionString('mysql://ro:x@mysql.internal/shop', 'mysql')).toMatchObject({ port: '3306', ssl: 'verify' })
    expect(parseConnectionString('postgres://ro:x@localhost/app?sslmode=disable', 'postgres')).toMatchObject({ ssl: 'off' })
    expect(parseConnectionString('postgres://ro:x@h/app?sslmode=verify-full', 'postgres')).toMatchObject({ ssl: 'verify' })
  })

  it('ignores partial input and URLs of another engine', () => {
    expect(parseConnectionString('', 'postgres')).toBeNull()
    expect(parseConnectionString('postgres://', 'postgres')).toBeNull()
    expect(parseConnectionString('postgres://ro@host', 'postgres')).toBeNull() // no database
    expect(parseConnectionString('mysql://ro:x@h/db', 'postgres')).toBeNull()
    expect(parseConnectionString('https://example.com/db', 'postgres')).toBeNull()
  })
})
