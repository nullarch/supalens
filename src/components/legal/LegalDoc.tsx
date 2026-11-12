import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

import LogoMark from "@/components/brand/LogoMark";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";

export { publicAlternates as legalAlternates } from "@/lib/metadata/public-origin";

type SectionProps = { h: string; id?: string; children: ReactNode };

/** Shared shell for the legal pages (이용약관 / 개인정보처리방침 / 환불정책) and long-form public
 *  docs. Colors use the global theme tokens (globals.css) so the pages render correctly in both
 *  light and `[data-theme="dark"]`. The table of contents is derived from the `<Section h>`
 *  children, so a page never has to list its headings twice. */
export async function LegalDoc({
  title,
  updated,
  kicker,
  children,
}: {
  title: string;
  updated: string;
  kicker?: string;
  children: ReactNode;
}) {
  const t = await getTranslations("legal");
  const tCommon = await getTranslations("common");

  // number the sections + collect their headings for the TOC
  let n = 0;
  const toc: { id: string; label: string }[] = [];
  const body = Children.map(children, (child) => {
    if (!isValidElement<SectionProps>(child) || typeof child.props.h !== "string") return child;
    n += 1;
    const id = child.props.id ?? `section-${n}`;
    toc.push({ id, label: child.props.h });
    return cloneElement(child as ReactElement<SectionProps>, { id });
  });

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px 96px", color: "var(--ink-2)", lineHeight: 1.75, fontSize: 15 }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 44 }}>
        <Link
          href="/"
          aria-label={tCommon("brandHome")}
          style={{ display: "inline-flex", alignItems: "center", gap: 9, color: "var(--ink)", textDecoration: "none" }}
        >
          <LogoMark size={22} />
          <span style={{ fontFamily: "var(--font-logo)", fontWeight: 650, fontSize: 23, letterSpacing: "-0.045em", textTransform: "lowercase" }}>
            supalens
          </span>
        </Link>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
          <Link href="/" style={{ fontSize: 13, color: "var(--ink-3)", textDecoration: "none" }}>
            {t("backHome")}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      {kicker && (
        <p style={{ color: "var(--clay-deep)", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 6px" }}>
          {kicker}
        </p>
      )}
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 4px", color: "var(--ink)" }}>{title}</h1>
      <p style={{ color: "var(--ink-3)", fontSize: 13, marginBottom: 24 }}>{updated}</p>

      {toc.length > 1 && (
        <nav
          aria-label={t("toc")}
          style={{ margin: "0 0 32px", padding: "14px 18px", background: "var(--paper-2)", border: "1px solid var(--line)", borderRadius: "var(--r-card)" }}
        >
          <p style={{ margin: "0 0 6px", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)" }}>
            {t("toc")}
          </p>
          <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2, fontSize: 13.5, lineHeight: 1.6 }}>
            {toc.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} style={{ color: "var(--ink-2)", textDecoration: "none" }}>
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>{body}</div>
      <hr style={{ margin: "40px 0 20px", border: "none", borderTop: "1px solid var(--line)" }} />
      <p style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
        Streamize Co., Ltd. · {t("ceoLabel")} {t("ceoName")} · {t("bizRegLabel")} 677-87-02793 ·{" "}
        <a href="mailto:admin@supalens.ai" style={{ color: "var(--ink-3)" }}>
          admin@supalens.ai
        </a>
      </p>
    </main>
  );
}

/** One titled section of a legal document. `id` is assigned by LegalDoc for the TOC anchors. */
export function Section({ h, id, children }: SectionProps) {
  return (
    <section id={id} style={{ scrollMarginTop: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px", color: "var(--ink)" }}>{h}</h2>
      <div style={{ color: "var(--ink-2)" }}>{children}</div>
    </section>
  );
}
