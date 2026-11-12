import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/utils/supabase/server";
import { latestExtraction, listKpis } from "@/lib/kpi/service";
import { listDashboardsForPicker } from "@/lib/dashboards/actions";
import { KpiReviewClient } from "./KpiReviewClient";

export const dynamic = "force-dynamic";

/**
 * Auto-KPI review page (design: docs/auto-kpi-plan.md — UX touchpoint 3). Server-loads the catalog +
 * latest extraction directly via the service layer (admin client — kpi_catalog is member-read via RLS
 * but not in the generated types), plus the dashboards list for the apply picker. Auth + membership
 * mirror /app/sources: RLS visibility on data_sources confirms the source is in the caller's org, and
 * a foreign / missing / Firestore source is a 404 (KPI extraction is SQL-only in v1).
 */
export default async function KpiReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const t = await getTranslations("appKpis");

  const supabase = await createClient();
  if (!supabase) {
    return <div style={{ padding: 40 }}>{t("supabaseNotConfigured")}</div>;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/app/sources/${id}/kpis`);
  }

  // RLS visibility confirms the source is in the caller's org; a foreign / deleted source is not
  // returned → 404.
  const { data: rows } = await supabase
    .from("data_sources")
    .select("id, name, engine, org_id")
    .eq("id", id)
    .is("deleted_at", null)
    .limit(1);
  const source = rows?.[0] as { id: string; name: string; engine: string; org_id: string } | undefined;
  if (!source) notFound();
  if (source.engine === "firestore") notFound();

  const [kpis, extraction, dashboards, { data: memberRow }] = await Promise.all([
    listKpis(id),
    latestExtraction(id),
    listDashboardsForPicker(),
    supabase
      .from("organization_members")
      .select("role")
      .eq("org_id", source.org_id)
      .eq("user_id", user.id)
      .limit(1),
  ]);
  const role = (memberRow?.[0] as { role: string } | undefined)?.role ?? "member";
  const canManage = role === "owner" || role === "admin" || role === "member";

  return (
    <KpiReviewClient
      sourceId={id}
      sourceName={source.name}
      initialKpis={kpis}
      initialExtraction={extraction}
      dashboards={dashboards}
      canManage={canManage}
    />
  );
}
