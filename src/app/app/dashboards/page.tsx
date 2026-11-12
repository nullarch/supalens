import { cookies } from "next/headers";

import { createClient } from "@/utils/supabase/server";
import { listDashboards, resolveActiveOrgId } from "@/lib/dashboards/fetch";
import { getHomeDashboardState } from "@/lib/dashboards/home";
import { userHasOrgRole } from "@/lib/org/require-role";
import { ACTIVE_ORG_COOKIE } from "@/lib/org/server";
import { EmptyDashboards } from "./EmptyDashboards";
import { ReportsIndex } from "./ReportsIndex";

export const dynamic = "force-dynamic";

/** Dashboards index — every saved board, the home board marked, with pin / rename / delete / set as home. */
export default async function DashboardsIndexPage() {
  const dashboards = await listDashboards();
  // Presentation identity only; the loader retains membership/RLS authorization.
  const workspaceKey = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? "default";
  if (dashboards.length === 0) return <EmptyDashboards key={workspaceKey} />;

  let homeId: string | null = null;
  let canSetHome = false;
  const supabase = await createClient();
  if (supabase) {
    const orgId = await resolveActiveOrgId(supabase);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (orgId && user) {
      const [home, admin] = await Promise.all([getHomeDashboardState(supabase, orgId), userHasOrgRole(supabase, orgId, user.id)]);
      homeId = home.home?.id ?? null;
      canSetHome = admin && home.settable;
    }
  }
  return <ReportsIndex key={workspaceKey} dashboards={dashboards} homeId={homeId} canSetHome={canSetHome} />;
}
