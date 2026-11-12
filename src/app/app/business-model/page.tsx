import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/utils/supabase/server";
import { ensurePrimaryOrg } from "@/lib/org/server";
import { PageHead } from "@/components/dashboard/PageHead";
import { BusinessModelIndex } from "./BusinessModelIndex";
import { loadContexts, loadSchemaHashes, loadSources, toRows } from "./data";

export const dynamic = "force-dynamic";

/**
 * /app/business-model — one row per data source showing what Supalens understood about it:
 * whether the SUPALENS.md context doc is current, whether it came from code or from the schema
 * alone, and how much structure it carries. The detail page is where the entities, rules and
 * metric definitions are actually read.
 *
 * Review/approval of individual rules is NOT here: there is no rule-level data model to record a
 * verdict against yet, so the screen deliberately shows understanding without pretending it can
 * be edited.
 */
export default async function BusinessModelPage() {
  const t = await getTranslations("appBusinessModel");

  const supabase = await createClient();
  if (!supabase) return <PageHead title={t("title")} subtitle={t("notConfigured")} />;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app/business-model");

  const orgId = await ensurePrimaryOrg(supabase, user);
  const sources = await loadSources(supabase, orgId);
  const ids = sources.map((r) => r.id);
  const [contexts, schemaHashes] = await Promise.all([loadContexts(supabase, ids), loadSchemaHashes(supabase, ids)]);
  const rows = toRows(sources, contexts, schemaHashes);
  return <BusinessModelIndex rows={rows} />;
}
