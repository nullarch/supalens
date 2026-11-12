import Link from "next/link";
import { ArrowDown, ArrowUpRight, ChevronRight, ShieldCheck } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { Link as LocaleLink } from "@/i18n/navigation";
import DatabaseLogo, { DATABASES } from "@/components/brand/DatabaseLogo";
import { CONNECT_HREF } from "../headers/shared";
import ProductPreview from "./ProductPreview";
import s from "./Hero.module.css";

/* Announcement tag → two-line serif headline → short copy → ink / outlined
   actions, then the wide "film" stage. The reference plays a brand video there;
   Supalens shows its actual workflow (a labeled sample) on the same kind of
   blurred indigo field. */
export default async function Hero() {
  const t = await getTranslations("globalProduct");
  const locale = await getLocale();
  const demoHref = `${locale === "en" ? "" : `/${locale}`}/demo`;

  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={`ed-container ${s.intro}`}>
        <LocaleLink href="/supabase" className={`ed-tag ed-tag--bloom ${s.announcement}`}>
          <span>{t("eyebrow")}</span>
          <ChevronRight size={14} aria-hidden />
        </LocaleLink>
        <h1 id="hero-title" className={s.title}>
          <span>{t("headline")}</span>
          <span>{t("headlineMuted")}</span>
        </h1>
        <p className={s.copy}>{t("description")}</p>
        <div className={`ed-actions ${s.actions}`}>
          <Link className="ed-button ed-button--primary" href={CONNECT_HREF}>
            {t("connect")}
          </Link>
          <a className="ed-button" href="#how">
            {t("how")}
            <ArrowDown size={15} aria-hidden />
          </a>
        </div>
        <p className={s.trust}>
          <ShieldCheck size={14} aria-hidden />
          {t("trust")}
        </p>
        <div className={s.connects}>
          <span className={s.connectsLabel}>{t("connectsTo")}</span>
          <ul className={s.logos}>
            {DATABASES.map((db) => (
              <li key={db.key}>
                <a href="#connections" className={s.logo} style={{ "--source-color": db.color } as React.CSSProperties}>
                  <DatabaseLogo name={db.key} size={18} />
                  {db.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className={`ed-wide ${s.stageWrap}`}>
        <div className={s.stage}>
          <div className="ed-film" aria-hidden />
          <div className={s.window}>
            <ProductPreview />
          </div>
        </div>
        <div className={s.caption}>
          <span>{t("previewLabel")}</span>
          <a className="ed-text-link" href={demoHref}>
            {t("tryDemo")}
            <ArrowUpRight size={15} aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
