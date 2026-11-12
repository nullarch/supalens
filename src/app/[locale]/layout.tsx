import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import { routing } from "@/i18n/routing";

// Keep the client translation boundary inside the changing locale segment.
// The shared root layout is cached across client navigation; its fallback
// provider alone would leave menus in the previously visited language.
// The single root still owns <html>/<body>; setRequestLocale preserves SSG.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);
  return <NextIntlClientProvider locale={locale}>{children}</NextIntlClientProvider>;
}
