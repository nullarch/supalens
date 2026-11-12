import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import "@/components/landing/editorial/editorial.css";
import { editorialFontVariables } from "@/components/landing/editorial/fonts";
import RevealOnScroll from "@/components/landing/editorial/RevealOnScroll";
import Header from "@/components/landing/editorial/Header";
import Hero from "@/components/landing/editorial/Hero";
import Principles from "@/components/landing/editorial/Principles";
import Connections from "@/components/landing/editorial/Connections";
import Workflow from "@/components/landing/editorial/Workflow";
import Monitoring from "@/components/landing/editorial/Monitoring";
import Security from "@/components/landing/editorial/Security";
import Pricing from "@/components/landing/editorial/Pricing";
import Faq from "@/components/landing/editorial/Faq";
import FinalCta from "@/components/landing/editorial/FinalCta";
import Footer from "@/components/landing/editorial/Footer";

import { publicAlternates } from "@/lib/metadata/public-origin";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: publicAlternates(locale, ''),
  };
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className={`ed ${editorialFontVariables}`}>
      {/* Editorial home (editorial design system): value → product proof → sources → how it works →
          monitoring → security → pricing. /supabase composes the same system. */}
      <RevealOnScroll />
      <Header />
      <Hero />
      <Principles />
      <Connections />
      <Workflow />
      <Monitoring />
      <Security />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}
