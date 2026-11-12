// NOT `import 'server-only'` — shared by the /x BFF, the /x pages and the Trigger task.
// All io runs through the untyped service-role client: xray_reports is service_role only
// (RLS on, no policies) because every visitor is anonymous. Pages only ever SELECT succeeded,
// un-hidden rows; the ledger columns (ip_hash, cookie_id) never leave this module.
import { createAdminClient } from '@/utils/supabase/admin'

import { XRAY_STALE_MS } from './config'
import { parseStoredReport, type XrayReport } from './schema'

export type XrayStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface XrayScanRow {
  id: string
  owner: string
  repo: string
  fullName: string
  defaultBranch: string | null
  commitSha: string | null
  locale: string
  status: XrayStatus
  report: XrayReport | null
  score: number | null
  grade: string | null
  fileCount: number | null
  errorCode: string | null
  triggerRunId: string | null
  createdAt: string
  completedAt: string | null
}

const PUBLIC_COLUMNS =
  'id, owner, repo, full_name, default_branch, commit_sha, locale, status, report, score, grade, file_count, error_code, trigger_run_id, created_at, completed_at'

type Raw = Record<string, unknown>

function toRow(raw: Raw): XrayScanRow {
  return {
    id: String(raw.id),
    owner: String(raw.owner),
    repo: String(raw.repo),
    fullName: String(raw.full_name),
    defaultBranch: (raw.default_branch as string | null) ?? null,
    commitSha: (raw.commit_sha as string | null) ?? null,
    locale: String(raw.locale ?? 'en'),
    status: raw.status as XrayStatus,
    report: raw.report ? parseStoredReport(raw.report) : null,
    score: (raw.score as number | null) ?? null,
    grade: (raw.grade as string | null) ?? null,
    fileCount: (raw.file_count as number | null) ?? null,
    errorCode: (raw.error_code as string | null) ?? null,
    triggerRunId: (raw.trigger_run_id as string | null) ?? null,
    createdAt: String(raw.created_at),
    completedAt: (raw.completed_at as string | null) ?? null,
  }
}

function isStale(row: Pick<XrayScanRow, 'status' | 'createdAt'>, now = Date.now()): boolean {
  return (row.status === 'queued' || row.status === 'running') && now - Date.parse(row.createdAt) > XRAY_STALE_MS
}

/** A dead in-flight row (task crashed before persisting) is closed so the one-in-flight index frees. */
async function reapIfStale(row: XrayScanRow): Promise<XrayScanRow> {
  if (!isStale(row)) return row
  const admin = createAdminClient()
  if (admin) {
    await admin
      .from('xray_reports')
      .update({ status: 'failed', error_code: 'stale', completed_at: new Date().toISOString() })
      .eq('id', row.id)
      .in('status', ['queued', 'running'])
  }
  return { ...row, status: 'failed', errorCode: 'stale' }
}

export async function getScan(id: string): Promise<XrayScanRow | null> {
  const admin = createAdminClient()
  if (!admin || !/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await admin.from('xray_reports').select(PUBLIC_COLUMNS).eq('id', id).is('hidden_at', null).limit(1)
  const raw = (data ?? [])[0] as Raw | undefined
  return raw ? reapIfStale(toRow(raw)) : null
}

/**
 * What /x/<owner>/<repo> should show: the newest succeeded report (the visitor's locale first,
 * then any), plus the newest in-flight scan if one is running. Hidden rows never surface.
 */
export async function getRepoState(
  owner: string,
  repo: string,
  locale: string,
): Promise<{ report: XrayScanRow | null; inflight: XrayScanRow | null; lastFailed: XrayScanRow | null }> {
  const admin = createAdminClient()
  if (!admin) return { report: null, inflight: null, lastFailed: null }
  const { data } = await admin
    .from('xray_reports')
    .select(PUBLIC_COLUMNS)
    .eq('owner', owner)
    .eq('repo', repo)
    .is('hidden_at', null)
    .order('created_at', { ascending: false })
    .limit(20)
  const rows = await Promise.all(((data ?? []) as Raw[]).map((raw) => reapIfStale(toRow(raw))))
  const succeeded = rows.filter((row) => row.status === 'succeeded' && row.report)
  const report = succeeded.find((row) => row.locale === locale) ?? succeeded[0] ?? null
  const inflight = rows.find((row) => row.status === 'queued' || row.status === 'running') ?? null
  const newest = rows[0] ?? null
  const lastFailed = newest?.status === 'failed' ? newest : null
  return { report, inflight, lastFailed }
}

/** The cache: a succeeded report of exactly this commit in this locale. */
export async function findCachedScan(owner: string, repo: string, sha: string, locale: string): Promise<XrayScanRow | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('xray_reports')
    .select(PUBLIC_COLUMNS)
    .eq('owner', owner)
    .eq('repo', repo)
    .eq('commit_sha', sha)
    .eq('locale', locale)
    .eq('status', 'succeeded')
    .is('hidden_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  const raw = (data ?? [])[0] as Raw | undefined
  return raw ? toRow(raw) : null
}

/** Newest succeeded report of this repo in this locale regardless of commit (the "already X-rayed" offer). */
export async function findLatestSucceeded(owner: string, repo: string, locale: string): Promise<XrayScanRow | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('xray_reports')
    .select(PUBLIC_COLUMNS)
    .eq('owner', owner)
    .eq('repo', repo)
    .eq('locale', locale)
    .eq('status', 'succeeded')
    .is('hidden_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  const raw = (data ?? [])[0] as Raw | undefined
  return raw ? toRow(raw) : null
}

export async function findInflight(owner: string, repo: string, locale: string): Promise<XrayScanRow | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data } = await admin
    .from('xray_reports')
    .select(PUBLIC_COLUMNS)
    .eq('owner', owner)
    .eq('repo', repo)
    .eq('locale', locale)
    .in('status', ['queued', 'running'])
    .limit(1)
  const raw = (data ?? [])[0] as Raw | undefined
  if (!raw) return null
  const row = await reapIfStale(toRow(raw))
  return row.status === 'failed' ? null : row
}

/** Sliding-window visitor count over both keys (max wins — see demo/service.ts). null → fail closed. */
export async function countVisitorScansSince(ipHash: string, cookieId: string, sinceIso: string): Promise<number | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const [byIp, byCookie] = await Promise.all([
    admin.from('xray_reports').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', sinceIso),
    admin.from('xray_reports').select('id', { count: 'exact', head: true }).eq('cookie_id', cookieId).gte('created_at', sinceIso),
  ])
  if (byIp.error || byCookie.error) {
    console.error('[xray] visitor count failed:', (byIp.error ?? byCookie.error)?.message)
    return null
  }
  return Math.max(byIp.count ?? 0, byCookie.count ?? 0)
}

/** Global live-scan count in the window (the XRAY_MAX_SCANS_PER_DAY budget). null → fail closed. */
export async function countScansSince(sinceIso: string): Promise<number | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { count, error } = await admin.from('xray_reports').select('id', { count: 'exact', head: true }).gte('created_at', sinceIso)
  if (error) {
    console.error('[xray] global count failed:', error.message)
    return null
  }
  return count ?? 0
}

/** Scans queued or running right now, with their age (stale ones don't count). null → fail closed. */
export async function countInflight(): Promise<number | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const since = new Date(Date.now() - XRAY_STALE_MS).toISOString()
  const { count, error } = await admin
    .from('xray_reports')
    .select('id', { count: 'exact', head: true })
    .in('status', ['queued', 'running'])
    .gte('created_at', since)
  if (error) {
    console.error('[xray] in-flight count failed:', error.message)
    return null
  }
  return count ?? 0
}

export interface NewScan {
  owner: string
  repo: string
  fullName: string
  defaultBranch: string
  commitSha: string
  locale: string
  ipHash: string
  cookieId: string
}

/** Insert a queued scan. `conflict` = another visitor started the same repo+locale a moment ago. */
export async function insertScan(scan: NewScan): Promise<{ id: string } | { conflict: true } | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data, error } = await admin
    .from('xray_reports')
    .insert({
      owner: scan.owner,
      repo: scan.repo,
      full_name: scan.fullName,
      default_branch: scan.defaultBranch,
      commit_sha: scan.commitSha,
      locale: scan.locale,
      ip_hash: scan.ipHash,
      cookie_id: scan.cookieId,
    })
    .select('id')
    .limit(1)
  if (error) {
    if (error.code === '23505') return { conflict: true }
    console.error('[xray] insert failed:', error.message)
    return null
  }
  const id = (data ?? [])[0]?.id as string | undefined
  return id ? { id } : null
}

export async function setTriggerRun(id: string, triggerRunId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin.from('xray_reports').update({ trigger_run_id: triggerRunId }).eq('id', id)
}

export async function markScanRunning(id: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin.from('xray_reports').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', id).eq('status', 'queued')
}

export async function recordCloneInfo(id: string, info: { fileCount: number; sha: string | null }): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const patch: Record<string, unknown> = { file_count: info.fileCount }
  if (info.sha) patch.commit_sha = info.sha
  await admin.from('xray_reports').update(patch).eq('id', id)
}

export async function completeScan(
  id: string,
  result: { report: XrayReport; costUsd: number; tokensIn: number; tokensOut: number },
): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  const { error } = await admin
    .from('xray_reports')
    .update({
      status: 'succeeded',
      report: result.report,
      score: result.report.score,
      grade: result.report.grade,
      cost_usd: result.costUsd,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw new Error(`xray persist failed: ${error.message}`)
}

export async function failScan(
  id: string,
  code: string,
  usage?: { costUsd: number; tokensIn: number; tokensOut: number },
): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  await admin
    .from('xray_reports')
    .update({
      status: 'failed',
      error_code: code.slice(0, 60),
      completed_at: new Date().toISOString(),
      ...(usage ? { cost_usd: usage.costUsd, tokens_in: usage.tokensIn, tokens_out: usage.tokensOut } : {}),
    })
    .eq('id', id)
}

export interface RecentXray {
  owner: string
  repo: string
  fullName: string
  grade: string
  headline: string
  traps: number
  kpis: number
}

/** Newest succeeded public reports, one per repo — the landing's "Recently X-rayed". */
export async function recentReports(limit = 8): Promise<RecentXray[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data, error } = await admin
    .from('xray_reports')
    .select('owner, repo, full_name, grade, report')
    .eq('status', 'succeeded')
    .is('hidden_at', null)
    .order('created_at', { ascending: false })
    .limit(limit * 4)
  if (error) return []
  const seen = new Set<string>()
  const out: RecentXray[] = []
  for (const raw of (data ?? []) as Raw[]) {
    const key = `${raw.owner}/${raw.repo}`
    const report = parseStoredReport(raw.report)
    if (seen.has(key) || !report) continue
    seen.add(key)
    out.push({
      owner: String(raw.owner),
      repo: String(raw.repo),
      fullName: String(raw.full_name),
      grade: String(raw.grade ?? report.grade),
      headline: report.traps[0]?.title ?? report.headline,
      traps: report.traps.length,
      kpis: report.kpis.length,
    })
    if (out.length >= limit) break
  }
  return out
}
