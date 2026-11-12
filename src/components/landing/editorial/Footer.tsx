import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import LogoMark from "@/components/brand/LogoMark";
import { COLUMN_HREFS, COMPANY, isExternal, type CatalogColumn } from "../Footer";
import s from "./Footer.module.css";

/* Ink footer: serif brand column plus the five link groups, then a borderless
   company row. Destinations and the Korean business disclosure come from the
   shared footer module. */
export default async function Footer({ sectionBase = "" }: { sectionBase?: "" | "/" } = {}) {
  const t = await getTranslations("footer");
  const common = await getTranslations("common");
  const columns = t.raw("columns") as CatalogColumn[];

  return (
    <footer className={s.footer}>
      <div className="ed-container">
        <div className={s.grid}>
          <Link href="/" className={s.brand} aria-label={common("brandHome")}>
            <LogoMark size={22} />
            <span>Supalens</span>
          </Link>
          {columns.map((column, columnIndex) => (
            <nav key={column.title} className={s.column} aria-label={column.title}>
              <h3 className={s.label}>{column.title}</h3>
              <ul>
                {column.links.map((label, linkIndex) => {
                  const stored = COLUMN_HREFS[columnIndex][linkIndex];
                  // Home-section anchors resolve against "/" on other pages.
                  const href = sectionBase && stored.startsWith("#") ? `${sectionBase}${stored}` : stored;
                  return (
                    <li key={label}>
                      {href.startsWith("/") ? (
                        <Link className={s.link} href={href}>
                          {label}
                        </Link>
                      ) : (
                        <a className={s.link} href={href}>
                          {label}
                          {isExternal(href) ? " ↗" : ""}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}
        </div>

        <div className={s.bottom}>
          <span>© 2026 {COMPANY.name}</span>
          <span className={s.business}>
            <span>
              {t("biz.name")} {COMPANY.name}
            </span>
            <span>
              {t("biz.ceo")} {t("biz.ceoName")}
            </span>
            <span>
              {t("biz.registrationNumber")} {COMPANY.registrationNumber}
            </span>
            <a className={s.link} href={`mailto:${COMPANY.email}`}>
              {COMPANY.email}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
