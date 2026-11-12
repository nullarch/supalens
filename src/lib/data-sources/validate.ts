import { z } from 'zod'

/** Input for registering a direct (non-OAuth) MySQL/Postgres data source. */
export const directDataSourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  engine: z.enum(['postgres', 'mysql']),
  provider: z.enum(['self_hosted', 'rds', 'neon', 'planetscale', 'generic']).default('self_hosted'),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(255),
  user: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(1024),
  // explicit parsing — z.coerce.boolean() treats the string "false" as true (truthy).
  // `require` = encrypt but do not verify the certificate chain (libpq sslmode=require): what a
  // self-signed server or a managed pooler with a private CA needs.
  ssl: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'on', 'off', 'require'])])
    .transform((v): boolean | 'require' => (v === 'require' ? 'require' : v === true || v === 'true' || v === '1' || v === 'on'))
    .default(false),
})

export type DirectDataSourceInput = z.infer<typeof directDataSourceSchema>

export function parseDirectDataSourceInput(raw: unknown):
  | { ok: true; value: DirectDataSourceInput }
  | { ok: false; error: string } {
  const r = directDataSourceSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  const first = r.error.issues[0]
  return { ok: false, error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'invalid input' }
}

/**
 * Input for registering a Firebase Firestore (document) data source. The raw service-account
 * JSON is carried as a string and parsed/validated (project_id / client_email / private_key) at
 * registration; only the non-secret bits land in data_sources.config, the JSON goes to the vault.
 */
export const firestoreDataSourceSchema = z.object({
  type: z.literal('firestore'),
  name: z.string().trim().min(1).max(120),
  serviceAccountJson: z.string().min(1).max(20_000),
  databaseId: z.string().trim().max(255).optional(),
})

export type FirestoreDataSourceInput = z.infer<typeof firestoreDataSourceSchema>

export function parseFirestoreDataSourceInput(raw: unknown):
  | { ok: true; value: FirestoreDataSourceInput }
  | { ok: false; error: string } {
  const r = firestoreDataSourceSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  const first = r.error.issues[0]
  return { ok: false, error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'invalid input' }
}
