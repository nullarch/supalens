import { getTranslations } from "next-intl/server";
import s from "./Principles.module.css";

type Principle = { kicker: string; title: string; sub: string };

/* Full-width ink band: centered serif statement over three product principles.
   The reference uses metrics here; Supalens states only what the product
   actually does, with no invented numbers. */
export default async function Principles() {
  const workflow = await getTranslations("globalWorkflow");
  const t = await getTranslations("stats");
  const items = t.raw("items") as Principle[];

  return (
    <section className={`ed-section ${s.band}`} aria-labelledby="principles-title">
      <div className="ed-container" data-reveal>
        <h2 id="principles-title" className={s.title}>
          {workflow("positioning")}
        </h2>
        <ul className={s.grid} aria-label={t("ariaLabel")}>
          {items.map((item) => (
            <li key={item.kicker} className={s.item}>
              <span className={s.kicker}>{item.kicker}</span>
              <strong className={s.name}>{item.title}</strong>
              <p className={s.sub}>{item.sub}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
