import { Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PLAN_META, type PlanText } from "../Pricing";
import s from "./Pricing.module.css";

/* Four plans in one pale panel. The recommended plan is the only inset white
   card with an ink action; the others use outlined actions. Plan limits and
   destinations come from the shared pricing module. */
export default async function Pricing() {
  const t = await getTranslations("pricing");
  const nav = await getTranslations("nav");
  const text = t.raw("plans") as PlanText[];
  const plans = PLAN_META.map((meta, index) => ({ ...meta, ...text[index] }));

  return (
    <section id="pricing" className="ed-section" aria-labelledby="pricing-title">
      <div className="ed-container" data-reveal>
        <header className="ed-head">
          <span className="ed-tag">{nav("pricing")}</span>
          <h2 id="pricing-title" className="ed-title">
            {t("head.title")}
          </h2>
          <p className="ed-lede">{t("head.subtitle")}</p>
        </header>

        <div className={`ed-panel ${s.panel}`}>
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`${s.plan} ${plan.featured ? s.featured : ""}`}
              aria-labelledby={`pricing-${plan.name}-title`}
            >
              <div className={s.badgeSlot}>
                {plan.featured ? <span className="ed-tag ed-tag--small">{t("badgeRecommended")}</span> : null}
              </div>
              <h3 id={`pricing-${plan.name}-title`} className={s.name}>
                {plan.name}
              </h3>
              <p className={s.price}>
                <span>{plan.price}</span>
                {plan.per ? <small>{plan.per}</small> : null}
              </p>
              <p className={s.tagline}>{plan.tagline}</p>
              <p className={s.intro}>{plan.intro}</p>
              <ul className={s.features}>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <Check size={14} aria-hidden />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <a
                className={`ed-button ${plan.featured ? "ed-button--primary" : ""} ${s.cta}`}
                href={plan.href}
                aria-label={`${plan.name}: ${plan.cta}`}
              >
                {plan.cta}
              </a>
            </article>
          ))}
        </div>

        <p className={s.note}>{t("note")}</p>
      </div>
    </section>
  );
}
