'use server'

import { sendActivationToHub } from '@/lib/event-hub/events'
import { createClient } from '@/utils/supabase/server'

/**
 * Stamp the caller's onboarding wizard as completed. Only the COMPLETING exits call this (see
 * logic.ts::exitCompletes — finishing the last act / the invitee tour); ✕, ESC and skips are
 * per-browser dismissals and never stamp, so the "Continue setup" pill keeps offering the rest.
 * Self-update rides the prof_upd RLS policy; the `.is()` filter keeps the write idempotent so
 * double-fires never move the timestamp.
 */
export async function completeWizard(): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return
  const completedAt = new Date().toISOString()
  const { data: stamped } = await supabase
    .from('profiles')
    .update({ wizard_completed_at: completedAt })
    .eq('id', user.id)
    .is('wizard_completed_at', null)
    .select('id')
  // A row came back only for the call that set it first, so a double-fire sends one event.
  if (stamped?.length) await sendActivationToHub(user.id, completedAt)
}
