import { redirect } from 'next/navigation'

/**
 * /app/alerts → /app/monitors. The alerts surface became "Monitors" (the operating view of approved
 * KPIs); old links in emails, Slack messages, bookmarks and the settings page keep working via this
 * redirect. Query params (e.g. `?edit=<id>`) are preserved.
 */
export default async function AlertsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') qs.set(k, v)
    else if (Array.isArray(v)) for (const x of v) qs.append(k, x)
  }
  const q = qs.toString()
  redirect(q ? `/app/monitors?${q}` : '/app/monitors')
}
