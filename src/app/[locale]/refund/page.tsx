import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalDoc, Section, legalAlternates } from "@/components/legal/LegalDoc";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "refund" });
  return { title: t("metaTitle"), alternates: legalAlternates(locale, "/refund") };
}

export default async function RefundPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("refund");
  const tLegal = await getTranslations("legal");

  return (
    <LegalDoc title={t("title")} updated={`${tLegal("effectiveDate")} · ${t("updated")}`}>
      <Section h={t("s1.h")}>{t.rich("s1.body", { b: (c) => <strong>{c}</strong> })}</Section>
      <Section h={t("s2.h")}>{t("s2.body")}</Section>
      <Section h={t("s3.h")}>{t("s3.body")}</Section>
      <Section h={t("s4.h")}>{t("s4.body")}</Section>
      <Section h={t("s5.h")}>{t("s5.body")}</Section>
    </LegalDoc>
  );
}
