import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalDoc, Section, legalAlternates } from "@/components/legal/LegalDoc";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "terms" });
  return { title: t("metaTitle"), alternates: legalAlternates(locale, "/terms") };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("terms");
  const tLegal = await getTranslations("legal");

  return (
    <LegalDoc title={t("title")} updated={`${tLegal("effectiveDate")} · ${t("updated")}`}>
      <Section h={t("s1.h")}>{t("s1.body")}</Section>
      <Section h={t("s2.h")}>{t("s2.body")}</Section>
      <Section h={t("s3.h")}>{t("s3.body")}</Section>
      <Section h={t("s4.h")}>{t.rich("s4.body", { b: (c) => <strong>{c}</strong> })}</Section>
      <Section h={t("s5.h")}>{t("s5.body")}</Section>
      <Section h={t("s6.h")}>{t.rich("s6.body", { b: (c) => <strong>{c}</strong> })}</Section>
      <Section h={t("s7.h")}>
        {t.rich("s7.body", {
          link: (c) => (
            <Link href="/refund" style={{ color: "var(--clay-deep)", fontWeight: 600 }}>
              {c}
            </Link>
          ),
        })}
      </Section>
      <Section h={t("s8.h")}>{t("s8.body")}</Section>
      <Section h={t("s9.h")}>{t("s9.body")}</Section>
      <Section h={t("s10.h")}>{t("s10.body")}</Section>
      <Section h={t("s11.h")}>{t("s11.body")}</Section>
      <Section h={t("s12.h")}>{t("s12.body")}</Section>
      <Section h={t("s13.h")}>{t("s13.body")}</Section>
      <Section h={t("appendix.h")}>{t("appendix.body")}</Section>
    </LegalDoc>
  );
}
