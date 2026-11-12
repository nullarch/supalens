// NOTE: intentionally NOT `import 'server-only'` — used by the email modules, which are
// shared with the Trigger.dev runtime (cron alert/digest sends). next-intl's
// `createTranslator` is REQUEST-INDEPENDENT (no cookies/headers), so it works on the
// Trigger host where the request-scoped `getTranslations` does NOT.

import { createTranslator } from 'next-intl'

// STATIC imports (not a dynamic `import(`messages/${loc}.json`)`) — esbuild on the
// Trigger host can't bundle a computed-path import, so the catalogs must be statically
// referenced to be included in the deployed task bundle.
import en from '../../../messages/en.json'
import ko from '../../../messages/ko.json'
import ja from '../../../messages/ja.json'

const CATALOGS: Record<string, Record<string, unknown>> = { en, ko, ja }
const DEFAULT_LOCALE = 'en'

export function normalizeLocale(locale?: string | null): string {
  return locale && CATALOGS[locale] ? locale : DEFAULT_LOCALE
}

// Permissive translator signature. next-intl infers `never` keys from an untyped
// (Record<string, unknown>) messages object, so we expose a plain string-keyed function
// for the email/notification call sites (they reference keys by string literal).
export type ServerT = (key: string, values?: Record<string, string | number | Date>) => string

/**
 * A request-free translator for server/cron paths (emails). Returns a next-intl translator
 * scoped to `namespace`. Falls back to the default locale for anything unrecognized. Async
 * to keep the call sites uniform (and future-proof if catalogs move to lazy loading).
 */
export async function getServerTranslator(
  locale: string | null | undefined,
  namespace: string,
): Promise<ServerT> {
  const loc = normalizeLocale(locale)
  return createTranslator({ locale: loc, messages: CATALOGS[loc], namespace }) as unknown as ServerT
}
