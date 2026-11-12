import { notFound } from "next/navigation";

import { createClient } from "@/utils/supabase/server";
import { getDashboardBySlug } from "@/lib/dashboards/fetch";
import { DashboardView } from "../DashboardView";
import { DashboardHeader } from "../DashboardHeader";

/**
 * Per-dashboard route (/app/dashboards/{slug}). For a real (Supabase-configured) user a
 * missing/deleted dashboard is a 404 — NOT the fake sample board it used to render. Local
 * dev without Supabase still falls back to the sample so the shell stays clickable.
 */
export default async function DashboardBySlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  if (supabase) {
    const detail = await getDashboardBySlug(slug);
    if (!detail) notFound();
    return (
      <div>
        <DashboardHeader dashboard={detail}>
          <DashboardView slug={slug} detail={detail} />
        </DashboardHeader>
      </div>
    );
  }

  // unconfigured (local dev) → demo sample
  return <DashboardView slug={slug} />;
}
