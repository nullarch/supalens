import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { createClient } from "@/utils/supabase/server";
import { ensurePrimaryOrg } from "@/lib/org/server";
import { getDashboardBySlug } from "@/lib/dashboards/fetch";
import { getHomeDashboardState } from "@/lib/dashboards/home";
import { TrackOnMount } from "@/components/analytics/TrackOnMount";
import { loadWorkspace } from "../reports/workspace";
import { OverviewView, type ProposalPreview } from "./OverviewView";

export const dynamic = "force-dynamic";

/**
 * /app/overview — the workspace's HOME DASHBOARD.
 *
 * It always shows the home board: the one the workspace chose ("show on Overview", owner/admin),
 * else Automatic — the AI-drafted core-KPI board, else the first favorite, else the first board.
 * The lede names which rule applied. Other boards live in the sidebar, one click away.
 *
 * Before the board has widgets the page says what is happening — analyzing, a draft ready to build,
 * get KPI proposals — instead of a blank grid. Reports live on /app/reports, not here.
 * An org with no real source renders the onboarding view.
 *
 * This is also the app's ONE onboarding surface: until the org is activated, a compact,
 * non-blocking checklist (SetupChecklist) sits above the board. There is no modal and no
 * full-screen gate anywhere in /app; /app/setup is the "details" destination, not the gate.
 */
export default async function OverviewPage() {
  const t = await getTranslations("appOverview");
  const supabase = await createClient();
  if (!supabase) return <div style={{ padding: 40 }}>{t("notConfigured")}</div>;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app/overview");

  const orgId = await ensurePrimaryOrg(supabase, user);
  const [ws, homeState] = await Promise.all([
    loadWorkspace(supabase, user, orgId, await getLocale()),
    getHomeDashboardState(supabase, orgId),
  ]);

  const board = homeState.home ? await getDashboardBySlug(homeState.home.slug) : null;
  const hasWidgets = !!board && board.widgets.length > 0;

  // The draft card previews the proposals a draft would use (same importance order).
  let proposals: ProposalPreview[] = [];
  if (!hasWidgets && ws.services.some((svc) => svc.pendingCount > 0)) {
    const { data } = await supabase
      .from("kpi_catalog")
      .select("id, title, importance, data_source_id")
      .eq("org_id", orgId)
      .eq("status", "proposed")
      .order("importance", { ascending: false })
      .limit(48);
    proposals = ((data ?? []) as { id: string; title: string; importance: number; data_source_id: string }[]).map((row) => ({
      id: row.id,
      title: row.title,
      importance: row.importance,
      dataSourceId: row.data_source_id,
    }));
  }

  return (
    <div>
      <TrackOnMount
        event="overview_viewed"
        params={{
          org_id: orgId,
          services: ws.services.length,
          boards: homeState.dashboards.length,
          home_widgets: hasWidgets ? board!.widgets.length : 0,
          home_chosen: homeState.chosen,
          kpi_count: ws.kpisAccepted,
        }}
      />
      <OverviewView
        orgId={orgId}
        activation={ws.activation}
        services={ws.services}
        canManage={ws.canManage}
        canSetHome={ws.isOrgAdmin && homeState.settable}
        connectionPending={ws.connectionPending}
        boards={homeState.dashboards}
        home={homeState.home}
        homeReason={homeState.reason}
        autoHome={homeState.auto}
        board={board}
        proposals={proposals}
      />
    </div>
  );
}
