import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import "@/components/landing/editorial/editorial.css";
import { editorialFontVariables } from "@/components/landing/editorial/fonts";
import RevealOnScroll from "@/components/landing/editorial/RevealOnScroll";
import Header from "@/components/landing/editorial/Header";
import SupabaseHero from "@/components/landing/editorial/SupabaseHero";
import ConnectFacts from "@/components/landing/editorial/ConnectFacts";
import SchemaVsCode from "@/components/landing/editorial/SchemaVsCode";
import SupabaseSteps from "@/components/landing/editorial/SupabaseSteps";
import Monitoring from "@/components/landing/editorial/Monitoring";
import Security from "@/components/landing/editorial/Security";
import Pricing from "@/components/landing/editorial/Pricing";
import FinalCta from "@/components/landing/editorial/FinalCta";
import Footer from "@/components/landing/editorial/Footer";

import { publicAlternates } from "@/lib/metadata/public-origin";
const PATH = "/supabase";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "supabasePage" });
  const title = t("meta.title");
  const description = t("meta.description");
  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Supalens" },
    twitter: { card: "summary_large_image", title, description },
    alternates: publicAlternates(locale, PATH),
  };
}

/**
 * `/supabase` — the ICP landing for teams already running on Supabase, in the
 * editorial system of the home page.
 *
 * A COMPOSITION, not a fork: only the entry (hero + path, what connecting does,
 * why code, the four steps) is Supabase-specific. Monitoring, security, pricing
 * and the closing CTA are the home page's own sections, so a copy fix lands on
 * both pages at once. The section ids the shared header and footer link to
 * (#how, #why-code, #monitoring, #security, #pricing) all exist on this page.
 */
export default async function SupabaseLanding({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className={`ed ${editorialFontVariables}`}>
      <RevealOnScroll />
      <Header />
      <SupabaseHero />
      <ConnectFacts />
      <SchemaVsCode />
      <SupabaseSteps />
      <Monitoring />
      <Security />
      <Pricing />
      <FinalCta />
      <Footer />
    </main>
  );
}
