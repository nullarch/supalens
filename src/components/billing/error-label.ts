/**
 * Map stable error CODES returned by the paddle server actions (startCheckout /
 * confirmCheckout / openBillingPortal) to localized display strings. Server actions
 * return codes, not display text, so they stay locale-free — localization happens here,
 * in the client component that already has the user's locale.
 */
const KNOWN_CODES = new Set([
  'invalid_plan',
  'not_configured',
  'price_not_configured',
  'unconfigured',
  'unauthorized',
  'forbidden',
  'no_billing_profile',
  'portal_url_missing',
  'portal_failed',
  'invalid_transaction_id',
  'transaction_not_found',
  'sync_failed',
])

type Translator = (key: string) => string

export function billingErrorLabel(t: Translator, code: string | undefined | null): string {
  if (code && KNOWN_CODES.has(code)) return t(`errors.${code}`)
  // syncCheckoutTransaction returns `transaction_<paddle status>` for unsettled states
  if (code?.startsWith('transaction_')) return t('errors.transaction_pending')
  return t('errors.generic')
}
