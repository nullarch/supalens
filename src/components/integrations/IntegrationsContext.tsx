'use client'

import { createContext, useContext, type ReactNode } from 'react'

import { ALL_INTEGRATIONS, type IntegrationAvailability } from '@/lib/integrations/types'

const IntegrationsContext = createContext<IntegrationAvailability>(ALL_INTEGRATIONS)

/**
 * Tells client components which optional integrations this install has registered, so they can
 * hide a connect button instead of sending the user into a provider flow that does not exist.
 * Mounted once by the /app layout with values computed on the server (the env is server-only).
 */
export function IntegrationsProvider({ value, children }: { value: IntegrationAvailability; children: ReactNode }) {
  return <IntegrationsContext.Provider value={value}>{children}</IntegrationsContext.Provider>
}

export function useIntegrations(): IntegrationAvailability {
  return useContext(IntegrationsContext)
}
