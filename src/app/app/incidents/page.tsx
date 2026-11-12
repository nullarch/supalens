import { redirect } from 'next/navigation'

import { monitorsViewHref } from '../monitors/view'

export const dynamic = 'force-dynamic'

/**
 * /app/incidents — the queue moved into /app/monitors as its second view (`?view=incidents`),
 * because a monitor and an incident are the same object in two states. This route stays as a
 * redirect so bookmarks and older links keep working; the `?status=` filter rides along.
 *
 * Only the LIST moved: /app/incidents/[id] is unchanged, since that is what the email, Slack and
 * Discord notifications deep-link to.
 */
export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams
  redirect(monitorsViewHref('incidents', status))
}
