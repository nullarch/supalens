import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PILLARS } from "../Security";
import s from "./Security.module.css";

type Guarantee = { title: string; body: string };

/* One pale panel divided by fine lines (the reference's inference layout)
   instead of four floating cards. Mechanism chips are real identifiers from
   the codebase; disclosure and compliance follow as plain editorial columns. */
export default async function Security() {
  const t = await getTranslations("security");
  const items = t.raw("items") as Guarantee[];
  const compliance = t.raw("compliance.items") as string[];

  return (
    <section id="security" className="ed-section" aria-labelledby="security-title">
      <div className="ed-container" data-reveal>
        <header className="ed-head">
          <span className="ed-tag">{t("eyebrow")}</span>
          <h2 id="security-title" className="ed-title">
            {t("heading")}
          </h2>
          <p className="ed-lede">{t("lede")}</p>
        </header>

        <div className={`ed-panel ${s.panel}`}>
          {PILLARS.map((pillar, index) => (
            <article key={pillar.kicker} className={s.cell}>
              <span className={s.kicker}>{pillar.kicker}</span>
              <h3 className={s.title}>{items[index].title}</h3>
              <p className={s.body}>{items[index].body}</p>
              <ul className={s.chips}>
                {pillar.tags.map((tag) => (
                  <li key={tag} className="ed-tag ed-tag--small ed-tag--neutral ed-tag--code">
                    {tag}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className={s.disclosure}>
          <div>
            <h3 className={s.label}>{t("transparency.title")}</h3>
            <p className={s.body}>{t("transparency.body")}</p>
          </div>
          <div>
            <h3 className={s.label}>{t("compliance.title")}</h3>
            <ul className={s.list}>
              {compliance.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link className="ed-text-link" href="/privacy">
              {t("compliance.privacyLink")}
              <ArrowRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
