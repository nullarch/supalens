import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
// Global product type, bundled with the app: Latin sans + CJK fallback, mono for code only.
// No runtime request to a font CDN — a self-hosted install must work on a closed network.
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import SupabaseProvider from "@/utils/supabase/provider";
import { GoogleAnalytics } from "@next/third-parties/google";
import { isCloud } from "@/config/edition";
import DocumentLocale from "@/components/i18n/DocumentLocale";
import { publicOrigin } from "@/lib/metadata/public-origin";

// Locale-neutral fallback. Marketing pages localize via `[locale]/generateMetadata`
// and /app pages set their own titles — this only fills gaps (English default).
export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin()),
  title: "Supalens — AI data operator for startups without a data team",
  description:
    "Connect Supabase and GitHub. Supalens reads your business rules from code, proposes execution-verified KPIs, monitors the ones you approve around the clock, and investigates anomalies before posting them to Slack.",
};

// The SINGLE root layout renders <html>/<body> for the whole app (marketing AND
// /app live under it). `lang` is resolved via next-intl's unified resolver:
// path segment for marketing, NEXT_LOCALE cookie for /app — see src/i18n/request.ts.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* no-FOUC theme boot: apply data-theme before first paint.
            localStorage("theme") wins; otherwise system preference. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider>
          <DocumentLocale />
          <SupabaseProvider>{children}</SupabaseProvider>
        </NextIntlClientProvider>
      </body>
      {/* Hosted edition only: a self-hosted install loads no third-party analytics. */}
      {isCloud() && process.env.NEXT_PUBLIC_GAID ? <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GAID} /> : null}
    </html>
  );
}
