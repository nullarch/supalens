import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { LegalDoc, Section, legalAlternates } from "@/components/legal/LegalDoc";
import { CopyBlock } from "./CopyBlock";

// Public MCP setup guide — the connector-directory "public documentation" page and the
// footer/McpHub "Setup guide" target. Unauthenticated by design (the in-app Developer settings
// page stays the key-management surface). Shares the LegalDoc shell: brand header, language
// switcher, auto table of contents, global theme tokens only.

const MCP_URL = "https://mcp.supalens.ai/mcp";
const CLAUDE_CODE_CMD = `claude mcp add --transport http supalens ${MCP_URL}`;
const API_KEY_EXAMPLE = `curl ${MCP_URL} \\
  -H "Authorization: Bearer sl_..." \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

// Primary CTA contract (shared with the landing / login / demo): land on Connections with the
// Supabase connect modal already open.
const CONNECT_HREF = "/login?next=%2Fapp%2Fsources%3Fconnect%3Dsupabase";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "docsMcp" });
  return { title: t("metaTitle"), description: t("metaDescription"), alternates: legalAlternates(locale, "/docs/mcp") };
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: "6px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default async function McpDocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("docsMcp");
  const tLegal = await getTranslations("legal");
  const copy = { copyLabel: t("copy"), copiedLabel: t("copied"), copyingLabel: t("copying"), failedLabel: t("copyFailed") };

  return (
    <LegalDoc kicker={t("kicker")} title={t("title")} updated={t("updated")}>
      <p style={{ margin: 0 }}>{t("intro")}</p>

      <Section h={t("url.h")}>
        {t("url.body")}
        <CopyBlock code={MCP_URL} label={t('url.h')} {...copy} />
      </Section>

      <Section h={t("why.h")}>
        <Bullets items={t.raw("why.items") as string[]} />
      </Section>

      <Section h={t("claude.h")}>
        <ol style={{ margin: "6px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          {(t.raw("claude.steps") as string[]).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Section>

      <Section h={t("code.h")}>
        {t("code.body")}
        <CopyBlock code={CLAUDE_CODE_CMD} label={t('code.h')} {...copy} />
      </Section>

      <Section h={t("other.h")}>
        {t("other.body")}
        <CopyBlock code={API_KEY_EXAMPLE} label={t('other.h')} {...copy} />
      </Section>

      <Section h={t("examples.h")}>
        <Bullets items={t.raw("examples.items") as string[]} />
      </Section>

      <Section h={t("tools.h")}>
        <Bullets items={t.raw("tools.items") as string[]} />
      </Section>

      <Section h={t("security.h")}>
        <Bullets items={t.raw("security.items") as string[]} />
      </Section>

      <Section h={t("trouble.h")}>
        <Bullets items={t.raw("trouble.items") as string[]} />
      </Section>

      <Section h={t("manage.h")}>
        {t("manage.body")}{" "}
        <Link href="/app/settings/developer" style={{ color: "var(--clay-deep)", fontWeight: 600 }}>
          {t("manage.link")}
        </Link>
        <div style={{ marginTop: 18 }}>
          <Link
            href={CONNECT_HREF}
            style={{
              display: "inline-flex",
              padding: "10px 20px",
              borderRadius: 'var(--r-control)',
              minHeight: 44,
              alignItems: 'center',
              background: "var(--action)",
              color: "var(--on-action)",
              fontSize: 14,
              fontWeight: 650,
              textDecoration: "none",
            }}
          >
            {tLegal("connectCta")}
          </Link>
        </div>
      </Section>
    </LegalDoc>
  );
}
