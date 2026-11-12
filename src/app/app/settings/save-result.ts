export type SettingsSaveResult = 'confirmed' | 'rejected' | 'unconfirmed' | 'migration'

/** A completed transport is not by itself proof that a preference was stored. */
export function settingsSaveResult(value: unknown, migrationMessage?: string): { kind: SettingsSaveResult; message?: string } {
  if (!value || typeof value !== 'object') return { kind: 'unconfirmed' }
  const result = value as Record<string, unknown>
  if (result.ok === true) return { kind: 'confirmed' }
  if (result.ok !== false) return { kind: 'unconfirmed' }
  const message = typeof result.message === 'string' && result.message.trim() ? result.message : undefined
  if (migrationMessage && result.reason === 'error' && message === migrationMessage) return { kind: 'migration', message }
  return { kind: 'rejected', message }
}
