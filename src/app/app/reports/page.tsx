import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { createClient } from "@/utils/supabase/server";
import { ensurePrimaryOrg } from "@/lib/org/server";
import { buildReports } from "@/lib/reports/build";
import { TrackOnMount } from "@/components/analytics/TrackOnMount";
import { ReportsView } from "./ReportsView";
import { loadWorkspace } from "./workspace";

export const dynamic = "force-dynamic";

/**
 * /app/reports — the report archive (lib/reports/build), split by SERVICE (data source).
 *
 *   ?view=all        every service's reports + a service status rail (default with two or more sources)
 *   ?source=<id>     one service: its reports only + that service's card (the only view with one source)
 *   ?type= ?tag= ?report=   feed filters and the open report document (client-side, ReportFeed)
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ source?: string; view?: string }>;
}) {
  const t = await getTranslations("appOverview");
  const sp = (await searchParams) ?? {};
  const supabase = await createClient();
  if (!supabase) return <div style={{ padding: 40 }}>{t("notConfigured")}</div>;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app/reports");

  const orgId = await ensurePrimaryOrg(supabase, user);
  const ws = await loadWorkspace(supabase, user, orgId, await getLocale());

  // Which view. One source has nothing to compare, so it is always shown in full.
  const selected = ws.services.find((svc) => svc.id === sp.source) ?? null;
  const view: "all" | "single" = ws.services.length <= 1 ? "single" : selected && sp.view !== "all" ? "single" : "all";
  const focusId = view === "single" ? (selected ?? ws.services[0])?.id ?? null : null;
  const focus = focusId && ws.services.length > 1 ? ws.services.find((svc) => svc.id === focusId) ?? null : null;
  const reports = buildReports(ws.reportInputs, focus ? { id: focus.id, name: focus.name } : null);

  return (
    <div>
      <TrackOnMount event="reports_viewed" params={{ view, services: ws.services.length, org_id: orgId, report_count: reports.length }} />
      <ReportsView
        view={view}
        focusId={focusId}
        services={ws.services}
        canManage={ws.canManage}
        intervalMin={ws.intervalMin}
        reports={reports}
        now={ws.now}
        timeZone={ws.timeZone}
        orgId={orgId}
        ackReady={ws.ackReady}
      />
    </div>
  );
}
