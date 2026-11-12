import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import "./dashboard.css";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { COLLAPSE_BOOT } from "@/components/dashboard/sidebar-boot";
import { getAppChrome } from "@/lib/dashboards/fetch";
import { Suspense } from "react";
import { OAuthReturnFeedback } from "@/components/feedback/OAuthReturnFeedback";
import { IntegrationsProvider } from "@/components/integrations/IntegrationsContext";
import { integrationAvailability } from "@/lib/integrations/availability";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("appChrome");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
  };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The shell mounts NO onboarding overlay. Onboarding is one non-blocking checklist on the
  // home screen (src/app/app/overview/SetupChecklist.tsx) — a modal here competed with it and
  // suppressed it, which is how a half-connected workspace ended up with no guide at all.
  const chrome = await getAppChrome();
  return <NextIntlClientProvider><IntegrationsProvider value={integrationAvailability()}><script dangerouslySetInnerHTML={{ __html: COLLAPSE_BOOT }} /><DashboardShell chrome={chrome}><Suspense fallback={null}><OAuthReturnFeedback /></Suspense>{children}</DashboardShell></IntegrationsProvider></NextIntlClientProvider>;
}
