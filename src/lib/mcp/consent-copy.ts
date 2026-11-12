import type { ConsentCopy } from './consent-document'

/** Keep the production and local-only document fixture on the same translated copy. */
export function consentCopy(t: (key: string, values?: Record<string, string>) => string, email: string): ConsentCopy {
  return {
    title: t('title'), description: t('review.description'), clientLabel: t('review.clientLabel'),
    clientIdLabel: t('review.clientIdLabel'), returnTo: t('review.returnTo'), permissions: t('review.permissions'),
    scopeNote: t('review.scopeNote'), accessNote: t('review.accessNote'), confirmNote: t('review.confirmNote'),
    approve: t('approve'), deny: t('deny'), loggedInAs: t('loggedInAs', { email }), backHome: t('review.backHome'),
  }
}
