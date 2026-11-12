import { track } from '@/utils/analytics'

export type WizardExtractRequest = (id: string) => Promise<{ status: number; body: unknown }>

/** Keep the existing source-scoped request and analytics; leave acknowledgement parsing to the caller. */
export const requestWizardExtraction: WizardExtractRequest = async id => {
  try {
    const response = await fetch(`/api/data-sources/${encodeURIComponent(id)}/kpis/extract`, { method: 'POST' })
    track('wizard_act4_extract', { ok: response.ok, status: response.status })
    return { status: response.status, body: await response.json().catch(() => null) }
  } catch (error) {
    track('wizard_act4_extract', { ok: false })
    throw error
  }
}
