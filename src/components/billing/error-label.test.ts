import { describe, expect, it } from 'vitest'
import { billingErrorLabel } from './error-label'
import en from '../../../messages/en.json'
import ko from '../../../messages/ko.json'
import ja from '../../../messages/ja.json'

describe('billing feedback', () => {
  it('localizes known server codes and does not expose raw provider errors', () => {
    expect(billingErrorLabel(key => key, 'forbidden')).toBe('errors.forbidden')
    expect(billingErrorLabel(key => key, 'provider secret or stack')).toBe('errors.generic')
    expect(billingErrorLabel(key => key, null)).toBe('errors.generic')
  })
  it('separates pending settlement from provisioning confirmation failure', () => {
    expect(billingErrorLabel(key => key, 'transaction_ready')).toBe('errors.transaction_pending')
    expect(billingErrorLabel(key => key, 'transaction_not_found')).toBe('errors.transaction_not_found')
    expect(billingErrorLabel(key => key, 'sync_failed')).toBe('errors.sync_failed')
  })
  it.each([en, ko, ja])('has complete checkout feedback in every supported locale', messages => {
    expect(Object.keys(messages.appBilling.checkoutState).sort()).toEqual(Object.keys(en.appBilling.checkoutState).sort())
    for (const value of Object.values(messages.appBilling.checkoutState)) expect(value.trim().length).toBeGreaterThan(0)
  })
})
