// Read-only Firestore data-access layer — the document-DB parallel of src/lib/query/*.
// Shared by the Firestore agent (src/lib/firestore-agent/*) and the connection probe.
// Produces the SAME QueryResult { columns, rows } contract as the SQL engine (via flatten),
// so the viz/widget layer is reused unchanged.
export { resolveFirestoreDataSource, invalidateFirestoreDataSource, type FirestoreConnection } from './resolve'
export { getFirestore, closeFirestore } from './client'
export {
  queryDocuments,
  describeQuery,
  type FirestoreQuery,
  type WhereClause,
  type WhereOp,
} from './query'
export { aggregateDocuments, type AggregateSpec, type AggOp } from './aggregate'
export { listCollections, inferCollectionSchema, type CollectionSchema, type CollectionField } from './introspect'
export { flattenDocuments, FIRESTORE_ID_COLUMN, type FlatDoc } from './flatten'
export { probeFirestore } from './probe'
