import { ArrowRight, Check, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import s from "./Workflow.module.css";

type Step = { title: string; body: string };

/* Section tag → serif heading → description, then three 4:3 visuals with a
   number tag, a 24px title and short copy. The visuals are illustrative. */
export default async function Workflow() {
  const t = await getTranslations("globalWorkflow");
  const items = t.raw("items") as Step[];
  const useCases = t.raw("useCases") as string[];

  const visuals = [
    <div key="context" className={s.visualStack}>
      <div className={s.codeRow}>
        public.orders
        <ArrowRight size={13} />
      </div>
      <div className={s.codeRow}>
        src/billing
        <ArrowRight size={13} />
      </div>
      <span className={s.visualNote}>Supabase + GitHub</span>
    </div>,
    <div key="rule" className={s.visualStack}>
      <div className={s.rule}>
        {t("rule")}
        <Check size={15} />
      </div>
      <span className={s.ruleCode}>
        completed payments
        <br />
        <em>without</em> active entitlements
      </span>
      <span className={s.visualNote}>{t("approved")}</span>
    </div>,
    <div key="signal" className={s.visualStack}>
      <div className={s.signal}>
        <Search size={20} />
        <span>
          {t("signal")}
          <small>{t("evidence")}</small>
        </span>
      </div>
      <div className={s.destination}>
        # business-alerts
        <ArrowRight size={13} />
      </div>
    </div>,
  ];

  return (
    <section id="how" className="ed-section" aria-labelledby="how-title">
      <div className="ed-container" data-reveal>
        <header className="ed-head">
          <span className="ed-tag">{t("eyebrow")}</span>
          <h2 id="how-title" className="ed-title">
            <span>{t("title")}</span>
            <span>{t("titleMuted")}</span>
          </h2>
          <p className="ed-lede">{t("description")}</p>
          <ul className={s.useCases}>
            {useCases.map((label) => (
              <li key={label} className="ed-tag ed-tag--small ed-tag--neutral">
                {label}
              </li>
            ))}
          </ul>
        </header>

        <div className={s.grid}>
          {items.map((item, index) => (
            <article key={item.title} id={index === 0 ? "why-code" : undefined} className={s.card}>
              <div className={s.visual} aria-hidden>
                {visuals[index]}
              </div>
              <span className={`ed-tag ed-tag--small ed-tag--code ${s.number}`}>0{index + 1}</span>
              <h3 className={s.cardTitle}>{item.title}</h3>
              <p className={s.cardBody}>{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
