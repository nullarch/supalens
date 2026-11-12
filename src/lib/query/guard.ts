/**
 * First line of defense for the read-only query path: reject anything that isn't a
 * single read-only statement. This is defense-in-depth ONLY — the authoritative guard
 * is the `supalens_ro` role (SELECT-only + default_transaction_read_only) plus the
 * READ ONLY transaction wrapper in execute.ts. Both must hold.
 */

export class UnsafeSqlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeSqlError'
  }
}

// Data-modifying keywords that could appear INSIDE an otherwise read-only statement:
// data-modifying CTEs (`with x as (insert/update/delete/merge ... returning ...)`) and
// `SELECT ... INTO`. Statement-leading verbs (DROP/ALTER/COPY/SET/…) are already caught
// by the "first word must be SELECT/WITH" + single-statement checks, so they're omitted
// here to avoid false-positives on common column names (comment, set, name, …). The READ
// ONLY transaction + the supalens_ro role are the authoritative backstop regardless.
const FORBIDDEN =
  /\b(insert|update|delete|merge|truncate|drop|alter|grant|revoke|into|returning)\b/i

/** Remove -- line comments and block comments so keywords can't hide inside them. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // /* ... */
    .replace(/--[^\n]*/g, ' ') // -- ...
}

/** Strip a single trailing semicolon + whitespace (for safe subquery wrapping). */
export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, '').trim()
}

export function assertReadOnly(rawSql: string): void {
  if (!rawSql || !rawSql.trim()) throw new UnsafeSqlError('empty SQL')

  const noComments = stripComments(rawSql).trim()
  const body = stripTrailingSemicolon(noComments)

  if (body.includes(';')) {
    throw new UnsafeSqlError('multiple statements are not allowed')
  }

  const firstWord = body.match(/^\s*\(*\s*([a-z]+)/i)?.[1]?.toLowerCase()
  if (firstWord !== 'select' && firstWord !== 'with') {
    throw new UnsafeSqlError(`only SELECT / WITH queries are allowed (got "${firstWord ?? '?'}")`)
  }

  const hit = body.match(FORBIDDEN)
  if (hit) {
    throw new UnsafeSqlError(`disallowed keyword "${hit[0]}" in read-only query`)
  }
}
