import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GithubRepoItem } from './GithubReposList'

export interface ConnectionRow {
  id: string; provider: string; display_name: string | null; status: string
  created_at: string; installation_id: number | null
}
export interface DataSourceRow {
  id: string; connection_id: string | null; name: string; engine: string; provider: string; status: string
}
export interface GithubRepoRow extends GithubRepoItem {
  connection_id: string; is_private: boolean; status: string
}

/** Selected-workspace reads, not every organization exposed by the caller's RLS membership. */
export async function loadIntegrationRows(supabase: SupabaseClient, orgId: string) {
  const [connections, sources, repos] = await Promise.all([
    supabase.from('provider_connections').select('id, provider, display_name, status, created_at, installation_id')
      .eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('data_sources').select('id, connection_id, name, engine, provider, status')
      .eq('org_id', orgId).is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('github_repositories').select('id, connection_id, full_name, default_branch, is_private, analysis_enabled, status')
      .eq('org_id', orgId).is('deleted_at', null).order('full_name', { ascending: true }),
  ])
  if ([connections, sources, repos].some(result => result.error || !Array.isArray(result.data))) throw new Error('integration_settings_unavailable')
  return { conns: connections.data as ConnectionRow[], sources: sources.data as DataSourceRow[], repos: repos.data as GithubRepoRow[] }
}
