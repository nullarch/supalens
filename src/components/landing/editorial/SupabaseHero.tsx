import Link from "next/link";
import { Activity, BadgeCheck, Github, ScrollText, ShieldCheck, Slack } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link as LocaleLink } from "@/i18n/navigation";
import DatabaseLogo from "@/components/brand/DatabaseLogo";
import { CONNECT_HREF } from "../headers/shared";
import s from "./SupabaseHero.module.css";

// One mark per beat of `supabasePage.flow`, in the order the app walks.
const MARKS = [
  <DatabaseLogo key="supabase" name="supabase" size={17} />,
  <Github key="github" size={17} strokeWidth={1.6} />,
  <ScrollText key="rules" size={17} strokeWidth={1.6} />,
  <BadgeCheck key="kpis" size={17} strokeWidth={1.6} />,
  <Activity key="monitor" size={17} strokeWidth={1.6} />,
  <Slack key="slack" size={17} strokeWidth={1.6} />,
];

/* Service-page hero in the editorial design system: centered tag → serif headline →
   copy → ink / outlined actions, then a wide 4:1 strip. The reference fills that
   strip with imagery; /supabase draws the whole product path on the same indigo
   film instead — a diagram of the real sequence, not a screenshot. */
export default async function SupabaseHero() {
  const t = await getTranslations("supabasePage");
  const product = await getTranslations("globalProduct");
  const flow = t.raw("flow") as string[];

  return (
    <section className={s.hero} aria-labelledby="hero-title">
      <div className={`ed-container ${s.intro}`}>
        <span className={`ed-tag ed-tag--bloom ${s.announcement}`}>
          <DatabaseLogo name="supabase" size={13} />
          {t("eyebrow")}
        </span>
        <h1 id="hero-title" className={s.title}>
          <span>{t("headline1")}</span>
          <span>{t("headline2")}</span>
        </h1>
        <p className={s.copy}>{t("lede")}</p>
        <div className={`ed-actions ${s.actions}`}>
          <Link className="ed-button ed-button--primary" href={CONNECT_HREF}>
            {t("ctaPrimary")}
          </Link>
          <LocaleLink className="ed-button" href="/demo">
            {t("ctaSecondary")}
          </LocaleLink>
        </div>
        <p className={s.trust}>
          <ShieldCheck size={14} aria-hidden />
          {product("trust")}
        </p>
      </div>

      <div className={`ed-wide ${s.stageWrap}`}>
        <div className={s.stage}>
          <div className="ed-film" aria-hidden />
          <p className={s.kicker}>{t("flowLabel")}</p>
          <ol className={s.path} aria-label={t("flowLabel")}>
            {flow.map((step, index) => (
              <li key={step} className={s.step} data-last={index === flow.length - 1 || undefined}>
                <span className={s.node} aria-hidden>
                  {MARKS[index]}
                </span>
                <span className={s.stepText}>
                  <span className={s.kickerIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={s.stepLabel}>{step}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
