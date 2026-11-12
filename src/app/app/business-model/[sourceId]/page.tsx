import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/utils/supabase/server";
import { PageHead } from "@/components/dashboard/PageHead";
import { metricKey, parseSupalensMd } from "@/lib/context/parse";
import { listKpis } from "@/lib/kpi/service";
import { StateDot, TierChip } from "../Bits";
import { hasDoc, loadContexts, loadSchemaHashes, resolveContextState } from "../data";
import { BusinessModelTabs, type MetricLink } from "./BusinessModelTabs";
import s from "../business-model.module.css";

export const dynamic = "force-dynamic";

/**
 * /app/business-model/[sourceId] — the structured read of one source's SUPALENS.md: the entity
 * map, the rules with their code/schema evidence, the metric definitions (and which KPI in the
 * catalog uses each), what changed since it was written, and the raw document.
 */
export default async function BusinessModelDetailPage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const t = await getTranslations("appBusinessModel");

  const supabase = await createClient();
  if (!supabase) return <PageHead title={t("title")} subtitle={t("notConfigured")} />;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/app/business-model/${encodeURIComponent(sourceId)}`);

  // RLS scopes data_sources to the caller's orgs, so a foreign id simply 404s.
  const { data: srcRows } = await supabase
    .from("data_sources")
    .select("id, name, engine, is_demo, repo_id")
    .eq("id", sourceId)
    .is("deleted_at", null)
    .limit(1);
  const src = srcRows?.[0] as
    | { id: string; name: string; engine: string; is_demo: boolean; repo_id: string | null }
    | undefined;
  if (!src) notFound();

  const [contexts, schemaHashes] = await Promise.all([
    loadContexts(supabase, [sourceId]),
    loadSchemaHashes(supabase, [sourceId]),
  ]);
  const ctx = contexts.get(sourceId);
  const state = resolveContextState(ctx, schemaHashes.get(sourceId));
  const parsed = parseSupalensMd(hasDoc(ctx) ? ctx!.contentMd! : "");
  const tier: "repo" | "schema" | null = hasDoc(ctx)
    ? ctx?.sourceRepoId
      ? "repo"
      : parsed.looksBaseline
        ? "schema"
        : "repo"
    : null;

  // Which catalog KPI (if any) each doc metric is behind. Best-effort: the catalog is read through
  // the service-role client, and a missing/unconfigured one just drops the badges.
  const metricLinks: Record<string, MetricLink> = {};
  if (src.engine !== "firestore") {
    try {
      for (const row of await listKpis(sourceId)) {
        for (const k of [metricKey(row.title), metricKey(row.key)]) {
          if (k && !metricLinks[k]) metricLinks[k] = { status: row.status, title: row.title };
        }
      }
    } catch {
      /* best-effort — no catalog, no badges */
    }
  }

  // Repo name for the Changes tab (github_repositories is member-read under RLS).
  let repoName: string | null = null;
  const repoId = ctx?.sourceRepoId ?? src.repo_id;
  if (repoId) {
    const { data: repoRows } = await supabase.from("github_repositories").select("full_name").eq("id", repoId).limit(1);
    repoName = (repoRows?.[0] as { full_name: string } | undefined)?.full_name ?? null;
  }

  return (
    <div className={s.wrap}>
      <Link href="/app/business-model" className={s.back}>
        ← {t("back")}
      </Link>
      <PageHead
        title={src.name}
        subtitle={parsed.title || t("subtitle")}
        actions={
          <span className={s.headMeta}>
            <StateDot state={state} label={t(`state.${state}`)} />
            {tier && <TierChip tier={tier} label={t(`tier.${tier}`)} />}
          </span>
        }
      />

      <BusinessModelTabs
        key={sourceId}
        sourceId={sourceId}
        parsed={parsed}
        state={state}
        metricLinks={metricLinks}
        generatedAt={ctx?.generatedAt ?? null}
        generatedFromSha={ctx?.generatedFromSha ?? null}
        schemaHash={ctx?.schemaHash ?? null}
        model={ctx?.model ?? null}
        error={ctx?.error ?? null}
        repoName={repoName}
      />
    </div>
  );
}
