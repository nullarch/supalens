import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalDoc, Section, legalAlternates } from "@/components/legal/LegalDoc";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });
  return { title: t("metaTitle"), alternates: legalAlternates(locale, "/privacy") };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("privacy");
  const tLegal = await getTranslations("legal");

  return (
    <LegalDoc title={t("title")} updated={`${tLegal("effectiveDate")} · ${t("updated")}`}>
      <Section h={t("s1.h")}>{t("s1.body")}</Section>
      <Section h={t("s2.h")}>{t("s2.body")}</Section>
      <Section h={t("s3.h")}>{t("s3.body")}</Section>
      <Section h={t("s4.h")}>{t("s4.body")}</Section>
      <Section h={t("s5.h")}>{t("s5.body")}</Section>
      <Section h={t("s6.h")}>{t("s6.body")}</Section>
      <Section h={t("s7.h")}>{t("s7.body")}</Section>
      <Section h={t("s8.h")}>{t("s8.body")}</Section>
      <Section h={t("s9.h")}>{t("s9.body")}</Section>
      <Section h={t("s10.h")}>{t("s10.body")}</Section>
      <Section h={t("s11.h")}>{t("s11.body")}</Section>
    </LegalDoc>
  );
}
