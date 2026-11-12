// Read-only query engine shared by dashboards, the MCP server, and the Trigger.dev agent.
export { executeReadOnly } from './run'
export { executeReadOnlyWithConfig } from './execute'
export { getSchema, rlsSchemaNote, type SchemaTable } from './introspect'
export { assertReadOnly, UnsafeSqlError, stripTrailingSemicolon } from './guard'
export { resolveDataSource, invalidateDataSource } from './dsn'
export { getPool, closePool, type AnyPool } from './pool'
export type { ConnectionConfig, DataSourceEngine, ExecuteOptions, QueryResult } from './types'
