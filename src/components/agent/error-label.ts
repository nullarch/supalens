/**
 * Map stable error CODES returned by `/api/agent/analyze` to localized display strings.
 * The route returns codes, not display text, so it stays locale-free — localization
 * happens here, in the client component that already has the user's locale. Mirrors
 * `src/components/billing/error-label.ts`.
 */
const KNOWN_CODES = new Set([
  'supabase_not_configured',
  'unauthorized',
  'invalid_body',
  'missing_fields',
  'question_too_long',
  'lookup_failed',
  'forbidden',
  'duplicate_run',
  'run_create_failed',
  'trigger_failed',
])

type Translator = (key: string) => string

export function askErrorLabel(t: Translator, code: string | undefined | null): string {
  if (code && KNOWN_CODES.has(code)) return t(`errors.${code}`)
  return t('errors.generic')
}
