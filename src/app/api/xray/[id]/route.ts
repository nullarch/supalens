import { auth } from '@trigger.dev/sdk'
import { NextResponse } from 'next/server'

import { getScan } from '@/lib/xray/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Status of one scan, for the scan page: it polls this as the Realtime fallback and to learn the
 * terminal state. While the scan is in flight it also hands out a fresh read-only token for that
 * ONE Trigger run, so a reload (or a second visitor on the same repo page) can re-attach to the
 * live stream. Reports are public; the token can only read this run's stream.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scan = await getScan(id)
  if (!scan) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const inflight = scan.status === 'queued' || scan.status === 'running'
  let publicToken: string | null = null
  if (inflight && scan.triggerRunId && process.env.TRIGGER_SECRET_KEY) {
    publicToken = await auth
      .createPublicToken({ scopes: { read: { runs: [scan.triggerRunId] } }, expirationTime: '2h' })
      .catch(() => null)
  }
  return NextResponse.json(
    {
      id: scan.id,
      status: scan.status,
      fullName: scan.fullName,
      path: `/x/${scan.owner}/${scan.repo}`,
      fileCount: scan.fileCount,
      errorCode: scan.errorCode,
      triggerRunId: inflight ? scan.triggerRunId : null,
      publicToken,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
