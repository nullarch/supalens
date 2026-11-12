import { redirect } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { appPublicUrl, githubAppSlug } from "@/lib/github-app/config";
import { countKpisByStatus, latestExtraction } from "@/lib/kpi/service";
import { ensurePrimaryOrg } from "@/lib/org/server";
import { PageHead } from "@/components/dashboard/PageHead";
import { SourcesClient, type SourceView, type RepoOption } from "./SourcesClient";

export const dynamic = "force-dynamic";

/** Per-source KPI catalog state, joined into SourceView for the ◆ KPI 카탈로그 chip. */
interface KpiChip {
  extractionStatus: "running" | "completed" | "failed" | null;
  extractionAt: string | null;
  proposed: number;
  accepted: number;
  stale: number;
}

interface DataSourceRow {
  id: string;
  org_id: string;
  connection_id: string | null;
  name: string;
  engine: string;
  provider: string;
  status: string;
  repo_id: string | null;
  is_demo: boolean;
}
interface AlertRow {
  data_source_id: string;
}
interface ChannelRow {
  org_id: string;
  label: string | null;
  target: string;
}
interface SchemaCacheRow {
  data_source_id: string;
  object_count: number | null;
  synced_at: string | null;
  status: string;
  content_hash: string | null;
}
interface ContextRow {
  data_source_id: string;
  status: string;
  source_repo_id: string | null;
  schema_hash: string | null;
}
interface RepoRow {
  id: string;
  full_name: string;
  default_branch: string | null;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Server-side relative time so the client renders a stable string (no hydration drift). */
function relativeTime(iso: string | null, t: Translate, intlLocale: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("time.hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t("time.daysAgo", { count: day });
  return new Date(iso).toLocaleDateString(intlLocale);
}

/** Map the app locale to an Intl locale for number/date formatting. */
function toIntlLocale(locale: string): string {
  return locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
}

export default async function DataSourcesPage() {
  const t = await getTranslations("appSources");
  const intlLocale = toIntlLocale(await getLocale());
  const supabase = await createClient();
  if (!supabase) {
    return <PageHead title={t("title")} subtitle={t("supabaseNotConfigured")} />;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/app/sources");
  }

  // Scoped to the ACTIVE workspace. RLS alone is NOT that scope — it admits every org the caller
  // belongs to, so a member of two workspaces saw both orgs' sources in one grid with nothing
  // saying which was which. The org switcher decides what this page shows.
  const orgId = await ensurePrimaryOrg(supabase, user);
  const [{ data: dsData }, { data: schemaData }, { data: ctxData }, { data: repoData }, { data: alertData }] = await Promise.all([
    supabase
      .from("data_sources")
      .select("id, org_id, connection_id, name, engine, provider, status, repo_id, is_demo")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("data_source_schemas").select("data_source_id, object_count, synced_at, status, content_hash"),
    supabase.from("data_source_context").select("data_source_id, status, source_repo_id, schema_hash"),
    // full_name is GitHub's own "owner/repo" — already discloses which connected org a repo
    // came from, so no join to provider_connections is needed to disambiguate multiple orgs.
    supabase
      .from("github_repositories")
      .select("id, full_name, default_branch")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("full_name", { ascending: true }),
    // Enabled monitors per source (the card's "감시" pipeline row). RLS member-read.
    supabase.from("alerts").select("data_source_id").eq("org_id", orgId).eq("enabled", true).is("deleted_at", null),
  ]);

  const monitorsBySource = new Map<string, number>();
  for (const a of (alertData ?? []) as AlertRow[]) {
    monitorsBySource.set(a.data_source_id, (monitorsBySource.get(a.data_source_id) ?? 0) + 1);
  }

  const schemaById = new Map(((schemaData ?? []) as SchemaCacheRow[]).map((r) => [r.data_source_id, r]));
  const ctxById = new Map(((ctxData ?? []) as ContextRow[]).map((r) => [r.data_source_id, r]));
  // The App's public page powers the "no admin rights → request installation" link. Resolved
  // here (server) because the config module reads GITHUB_APP_* env and must not reach the client.
  const slug = githubAppSlug();
  const githubAppUrl = slug ? appPublicUrl(slug) : null;

  const repos = (repoData ?? []) as RepoRow[];
  const repoNameById = new Map(repos.map((r) => [r.id, r.full_name]));
  const availableRepos: RepoOption[] = repos.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    defaultBranch: r.default_branch ?? "main",
  }));

  // KPI catalog state per source (for the ◆ KPI 카탈로그 chip). kpi_catalog / kpi_extractions are
  // member-read via RLS but not in the generated types yet, so we read them through the service-role
  // client (already visibility-scoped to this org via the RLS-checked dsData ids above). Skipped for
  // Firestore (chip hidden) and when the service role isn't configured (local dev) — the chip then
  // falls back to its default (추출) state.
  const admin = createAdminClient();
  const kpiById = new Map<string, KpiChip>();
  // Org-level Slack alert destination for the card's "알림 채널" row. notification_channels is
  // owner/admin-only under RLS (the row is a posting route), but the channel NAME is not a secret —
  // read it through the service-role client, scoped to the orgs the RLS-visible sources belong to.
  const slackByOrg = new Map<string, string>();
  if (admin) {
    const orgIds = [...new Set(((dsData ?? []) as DataSourceRow[]).map((r) => r.org_id))];
    if (orgIds.length > 0) {
      try {
        const { data: chData } = await admin
          .from("notification_channels")
          .select("org_id, label, target")
          .in("org_id", orgIds)
          .eq("provider", "slack")
          .eq("enabled", true)
          .is("deleted_at", null)
          .order("created_at", { ascending: true });
        for (const c of (chData ?? []) as ChannelRow[]) {
          if (!slackByOrg.has(c.org_id)) slackByOrg.set(c.org_id, c.label || c.target);
        }
      } catch {
        /* best-effort — the row falls back to "미연결" */
      }
    }
  }
  if (admin) {
    await Promise.all(
      ((dsData ?? []) as DataSourceRow[])
        .filter((r) => r.engine !== "firestore")
        .map(async (r) => {
          try {
            const [ext, counts] = await Promise.all([latestExtraction(r.id), countKpisByStatus(r.id)]);
            kpiById.set(r.id, {
              extractionStatus: ext?.status ?? null,
              extractionAt: ext?.createdAt ?? null,
              proposed: counts.proposed,
              accepted: counts.accepted,
              stale: counts.stale,
            });
          } catch {
            /* best-effort — a missing catalog leaves the chip in its default state */
          }
        }),
    );
  }

  const sources: SourceView[] = ((dsData ?? []) as DataSourceRow[]).map((row) => {
    const cache = schemaById.get(row.id);
    const ctx = ctxById.get(row.id);
    // read-time schema-drift: a 'fresh' doc whose stamped schema_hash no longer matches the current
    // introspection hash is effectively stale (the schema changed under it).
    let contextStatus = ctx?.status ?? null;
    if (
      contextStatus === "fresh" &&
      ctx?.schema_hash &&
      cache?.content_hash &&
      ctx.schema_hash !== cache.content_hash
    ) {
      contextStatus = "stale";
    }
    const kpi = kpiById.get(row.id);
    return {
      id: row.id,
      name: row.name,
      engine: row.engine,
      provider: row.provider,
      status: row.status,
      isOAuth: row.connection_id != null,
      tableCount: cache?.object_count ?? null,
      lastSyncedLabel: cache?.synced_at ? relativeTime(cache.synced_at, t, intlLocale) : "—",
      syncStatus: cache?.status ?? null,
      attachedRepoId: row.repo_id,
      attachedRepoFullName: row.repo_id ? repoNameById.get(row.repo_id) ?? null : null,
      contextStatus,
      contextFromRepo: ctx?.source_repo_id != null,
      isDemo: row.is_demo,
      monitorCount: monitorsBySource.get(row.id) ?? 0,
      slackChannel: slackByOrg.get(row.org_id) ?? null,
      kpiExtractionStatus: kpi?.extractionStatus ?? null,
      kpiExtractionAt: kpi?.extractionAt ?? null,
      kpiProposed: kpi?.proposed ?? 0,
      kpiAccepted: kpi?.accepted ?? 0,
      kpiStale: kpi?.stale ?? 0,
    };
  });

  // The page head (title, lede, connect action) renders inside SourcesClient: its
  // action opens the client-side connect modal.
  return <SourcesClient sources={sources} repos={availableRepos} githubAppUrl={githubAppUrl} />;
}
