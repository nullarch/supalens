import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link as LocaleLink } from "@/i18n/navigation";
import { CONNECT_HREF } from "../headers/shared";
import s from "./FinalCta.module.css";

type Action = { href: string; label: string };

/* Cinematic closing stage: night indigo field with grain and the Supalens orbit
   drawn at scale, copy anchored bottom-left. No remote imagery. Other pages can
   swap the headline, note and secondary action. */
export default async function FinalCta({
  title,
  note,
  secondary,
}: { title?: string; note?: string; secondary?: Action } = {}) {
  const t = await getTranslations("finalCta");
  const secondaryAction = secondary ?? { href: "/demo", label: t("ctaSecondary") };

  return (
    <section className="ed-section" aria-labelledby="final-cta-title">
      <div className={`ed-wide ${s.stage}`} data-reveal>
        <svg className={s.orbit} viewBox="0 0 48 48" aria-hidden>
          <circle cx="18" cy="28" r="13" />
          <circle cx="35" cy="15" r="7.5" />
          <circle cx="38" cy="34" r="3.6" />
        </svg>
        <div className={s.copy}>
          <h2 id="final-cta-title" className={s.title}>
            {title ?? t("line")}
          </h2>
          <div className={`ed-actions ${s.actions}`}>
            <Link className={`ed-button ${s.primary}`} href={CONNECT_HREF}>
              {t("ctaPrimary")}
              <ArrowRight size={15} aria-hidden />
            </Link>
            <LocaleLink className={`ed-button ${s.secondary}`} href={secondaryAction.href}>
              {secondaryAction.label}
            </LocaleLink>
          </div>
          <p className={s.note}>{note ?? t("note")}</p>
        </div>
      </div>
    </section>
  );
}
