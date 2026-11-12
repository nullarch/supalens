// NOTE: intentionally NOT `import 'server-only'` — shared with the Trigger.dev runtime
// (the agent runners import it), whose esbuild bundle throws on the server-only shim.

// Language directive appended to the agent system prompt. The prompt SCAFFOLDING stays
// English/stable (translating it is a correctness regression) — we only tell the model
// which language to WRITE THE ANSWER in. Locale comes from the run's originating user.
const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  ko: 'Korean (한국어)',
  ja: 'Japanese (日本語)',
}

const DEFAULT_LOCALE = 'en'

/**
 * Returns a trailing system-prompt section instructing the model to answer in the user's
 * language, or '' for the default locale (English) where no instruction is needed. SQL,
 * column names, and code identifiers must stay verbatim — only prose is translated.
 */
export function languageDirective(locale?: string | null): string {
  const loc = locale && LOCALE_NAMES[locale] ? locale : DEFAULT_LOCALE
  if (loc === DEFAULT_LOCALE) return ''
  const name = LOCALE_NAMES[loc]
  return `\n\n## Response language\nWrite your prose response to the user in ${name}. Keep SQL, column names, table names, code identifiers, and numeric values verbatim (do not translate or localize them) — only the explanatory prose should be in ${name}.`
}
