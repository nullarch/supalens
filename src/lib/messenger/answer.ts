// NOT `import 'server-only'` — the reply types + resolvers are shared by the Slack events
// route (BFF) and the messenger-answer Trigger task. Provider-neutral on purpose: a future
// Teams connector reuses ReplyRef/MessengerAnswerPayload and adds an adapter, not a new task.
import { appOrigin } from '@/config/edition'
import { requireAdminClient } from '@/utils/supabase/admin'

/** Absolute app origin for links posted into messengers (Slack renders no relative paths).
 *  www, not apex — apex 307s to www and the Trigger host has no NEXT_PUBLIC_APP_URL env. */
export const APP_URL = appOrigin('https://www.supalens.ai')

/** Where to post the answer back. Provider-tagged so the task picks the right adapter. */
export interface SlackReplyRef {
  provider: 'slack'
  /** provider_connection holding the bot token to post through. */
  connectionId: string
  channel: string
  /** reply in-thread under the mention when set. */
  threadTs?: string
}
/** Slash-command reply target: Slack's per-invocation response_url (no bot-in-channel needed). */
export interface SlackResponseUrlRef {
  provider: 'slack_response_url'
  responseUrl: string
}
export type ReplyRef = SlackReplyRef | SlackResponseUrlRef

/** Payload contract for the `messenger-answer` Trigger task (declared here, imported by both sides). */
export interface MessengerAnswerPayload {
  orgId: string
  dataSourceId: string
  engine: string
  runId: string
  question: string
  /** org locale (resolved by the events route) — the agent answers in this language. */
  locale?: string
  reply: ReplyRef
}

export interface SlackWorkspace {
  orgId: string
  connectionId: string
  /** owner/admin-set mention allowlist. Empty = the bot answers in ANY channel (default). */
  allowedChannelIds: string[]
}

/**
 * Resolve a Slack team_id to the org + connection that installed the bot (active only).
 * One team = one org is enforced at connect time + by the pc_slack_team_live unique index;
 * the created_at ordering is a deterministic defense for any pre-index residue.
 */
export async function resolveSlackWorkspace(teamId: string): Promise<SlackWorkspace | null> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('provider_connections')
    .select('id, org_id, metadata')
    .eq('provider', 'slack')
    .eq('external_account_id', teamId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
  const row = data?.[0] as { id: string; org_id: string; metadata: Record<string, unknown> | null } | undefined
  if (!row) return null
  const raw = (row.metadata as { allowed_channel_ids?: unknown } | null)?.allowed_channel_ids
  const allowedChannelIds = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  return { orgId: row.org_id, connectionId: row.id, allowedChannelIds }
}

/**
 * Is a mention in `channel` allowed to run? Empty allowlist → yes (workspace = org trust default);
 * a non-empty allowlist → only its channels (owner/admin scoping, Phase 4 hardening).
 */
export function isChannelAllowed(allowedChannelIds: string[], channel: string): boolean {
  return allowedChannelIds.length === 0 || allowedChannelIds.includes(channel)
}

export type DefaultSourceResult =
  | { ok: true; id: string; engine: string }
  // no rendered message here — the ROUTE translates (slackBot.multipleSources / slackBot.noSources)
  // in the org's locale; keeping the core message-free keeps it pure + locale-agnostic.
  | { ok: false; reason: 'multiple'; names: string[] }
  | { ok: false; reason: 'none' }

/**
 * Pick the data source a mention runs against. Semantics (friendly-message variant of MCP
 * `resolveDataSourceId`, demo-aware): exactly one REAL (non-demo) active source → auto-pick;
 * no real source but the demo exists → the demo (try-before-connect works from Slack too);
 * several real sources → ask to disambiguate on the web. The auto-provisioned demo source
 * must NOT count toward "several" — every org has one, which would otherwise permanently
 * block mentions for the common one-real-DB org.
 */
export async function resolveDefaultDataSource(orgId: string): Promise<DefaultSourceResult> {
  const admin = requireAdminClient()
  const { data } = await admin
    .from('data_sources')
    .select('id, name, engine, is_demo')
    .eq('org_id', orgId)
    .eq('status', 'active') // mirror the /app/ask picker — never run against error/disabled sources
    .is('deleted_at', null)
  return pickDefaultSource((data ?? []) as SourceRow[])
}

export interface SourceRow {
  id: string
  name: string
  engine: string
  is_demo: boolean | null
}

/** Pure selection core of resolveDefaultDataSource (unit-tested — the demo-exclusion invariant). */
export function pickDefaultSource(rows: SourceRow[]): DefaultSourceResult {
  const real = rows.filter((r) => !r.is_demo)
  if (real.length === 1) return { ok: true, id: real[0].id, engine: real[0].engine }
  if (real.length > 1) return { ok: false, reason: 'multiple', names: real.map((r) => r.name) }
  // no real source — fall back to the demo so the mention still demonstrates value
  if (rows.length > 0) return { ok: true, id: rows[0].id, engine: rows[0].engine }
  return { ok: false, reason: 'none' }
}

/** Render a DefaultSourceResult failure in the org's locale (shared by the two Slack routes). */
export function describeSourceFailure(
  t: (key: string, values?: Record<string, string | number | Date>) => string,
  r: Extract<DefaultSourceResult, { ok: false }>,
): string {
  return r.reason === 'multiple'
    ? t('multipleSources', { names: r.names.join(', '), url: `${APP_URL}/app/ask` })
    : t('noSources', { url: `${APP_URL}/app/sources` })
}

/** Strip Slack user mentions (`<@U…>`) from an app_mention text to get the raw question. */
export function stripMentions(text: string): string {
  return text.replace(/<@[^>]+>/g, '').trim()
}
