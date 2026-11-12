import { afterEach, describe, expect, it, vi } from 'vitest'

/** `activation` goes out only for the call that actually stamped wizard_completed_at. */

const sendActivationToHub = vi.fn()
vi.mock('@/lib/event-hub/events', () => ({
  sendActivationToHub: (...args: unknown[]) => sendActivationToHub(...args),
}))

let stampedRows: unknown[] | null = []
const update = vi.fn()
vi.mock('@/utils/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      update: (values: unknown) => {
        update(values)
        const chain = { eq: () => chain, is: () => chain, select: async () => ({ data: stampedRows, error: null }) }
        return chain
      },
    }),
  }),
}))

import { completeWizard } from './actions'

afterEach(() => vi.clearAllMocks())

describe('completeWizard', () => {
  it('sends activation with the stored timestamp the first time', async () => {
    stampedRows = [{ id: 'user-1' }]
    await completeWizard()
    expect(sendActivationToHub).toHaveBeenCalledWith('user-1', update.mock.calls[0][0].wizard_completed_at)
  })

  it('sends nothing when the wizard was already completed', async () => {
    stampedRows = []
    await completeWizard()
    expect(sendActivationToHub).not.toHaveBeenCalled()
  })
})
