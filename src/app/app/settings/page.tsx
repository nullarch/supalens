import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/utils/supabase/server";
import { ensurePrimaryOrg } from "@/lib/org/server";
import { readOrgTimezone } from "@/lib/org/timezone";

import { SettingsView } from "./SettingsView";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const t = await getTranslations("appSettings");
  const supabase = await createClient();
  if (!supabase) {
    return <div style={{ padding: 40 }}>{t("notConfigured")}</div>;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/app/settings");
  }

  const orgId = await ensurePrimaryOrg(supabase, user);
  const { data: orgRows } = await supabase
    .from("organizations")
    .select("name, slug, weekly_digest_enabled")
    .eq("id", orgId)
    .limit(1);
  const org = (orgRows?.[0] as { name: string; slug: string; weekly_digest_enabled: boolean | null } | undefined) ?? {
    name: "",
    slug: "",
    weekly_digest_enabled: false,
  };

  // Read on its own query: joining `timezone` into the select above would fail the WHOLE
  // query before the migration lands and blank out the org name with it.
  const { timezone, pendingMigration } = await readOrgTimezone(supabase, orgId);

  const { data: memberRows } = await supabase
    .from("organization_members")
    .select("role, email_digest_opt_out, email_alert_opt_out, email_lifecycle_opt_out")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .limit(1);
  const member = (memberRows?.[0] as {
    role: string;
    email_digest_opt_out: boolean | null;
    email_alert_opt_out: boolean | null;
    email_lifecycle_opt_out: boolean | null;
  } | undefined) ?? null;
  const myRole = member?.role ?? "member";
  const canEditOrg = myRole === "owner" || myRole === "admin";

  return <SettingsView orgId={orgId} name={org.name} slug={org.slug} timezone={timezone} pendingMigration={pendingMigration}
    canEditOrg={canEditOrg} isOwner={myRole === "owner"} weeklyDigestEnabled={org.weekly_digest_enabled ?? false}
    digestOptOut={member?.email_digest_opt_out ?? false} alertOptOut={member?.email_alert_opt_out ?? false}
    lifecycleOptOut={member?.email_lifecycle_opt_out ?? false} />;
}
