import { describe, expect, it } from 'vitest'

import { assertReadOnly } from './guard'

describe('assertReadOnly', () => {
  const allow = [
    'select 1',
    'select comment from posts', // common column name — must NOT be over-blocked
    'select id, set_value from t',
    'with c as (select 1 n) select * from c',
    'select * from a union select * from b',
    'SELECT count(*) FROM "user"',
    'select * from orders where status = \'inserted\'', // keyword inside a string literal
  ]
  const block = [
    'update t set x = 1',
    'delete from t',
    'drop table t',
    'insert into t values (1)',
    'truncate t',
    'alter table t add column x int',
    'select 1; drop table t', // multi-statement
    'with x as (insert into t values (1) returning *) select * from x', // data-modifying CTE
    'select a into tmp from t', // SELECT INTO
    '',
    '   ',
  ]

  for (const sql of allow) {
    it(`allows: ${sql}`, () => expect(() => assertReadOnly(sql)).not.toThrow())
  }
  for (const sql of block) {
    it(`blocks: ${sql || '(empty)'}`, () => expect(() => assertReadOnly(sql)).toThrow())
  }
})
