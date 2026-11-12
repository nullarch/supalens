import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { isSelfHosted } from "@/config/edition";
import { createClient } from "@/utils/supabase/server";
import { ensurePrimaryOrg } from "@/lib/org/server";
import { isCurrentUserAdmin } from "@/lib/auth/is-admin";
import { getBillingSummary } from "@/lib/plans/summary";
import { configuredPrices, adminTestPriceId, isPaddleConfigured } from "@/lib/paddle/config";
import { reconcileOrgSubscription } from "@/lib/paddle/sync";
import { ensureFreshPeriod } from "@/lib/plans/usage";

import { BillingView } from "./BillingView";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  // No plans and no checkout on a self-hosted install.
  if (isSelfHosted()) notFound();
  const t = await getTranslations("appBilling");
  const supabase = await createClient();
  if (!supabase) return <div style={{ padding: 40 }}>{t("supabaseNotConfigured")}</div>;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app/settings/billing");

  const orgId = await ensurePrimaryOrg(supabase, user);
  const billingConfigured = isPaddleConfigured();
  // Webhook-less freshness: re-read the linked subscription from the Paddle API before rendering,
  // so renewals/cancellations show without webhooks. Fail-soft — stored state still renders.
  if (billingConfigured) {
    try {
      await reconcileOrgSubscription(orgId);
    } catch (err) {
      console.error("[billing] page reconcile failed:", err);
    }
    // Free orgs roll their usage window lazily (inside checkUsageQuota) — freshen it here so
    // the page never shows a lapsed period with stale counts.
    await ensureFreshPeriod(orgId);
  }
  const summary = await getBillingSummary(orgId);
  if (!summary) return <div style={{ padding: 40 }}>{t("loadFailed")}</div>;

  const yearlyAvailable = billingConfigured && configuredPrices().some((p) => p.interval === "year");
  // staff-only $1 test checkout — shown only to platform admins when the price is configured
  const adminTestAvailable = billingConfigured && adminTestPriceId() !== null && (await isCurrentUserAdmin());

  return <BillingView summary={summary} billingConfigured={billingConfigured} yearlyAvailable={yearlyAvailable} adminTestAvailable={adminTestAvailable} />;
}
