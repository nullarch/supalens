import { Fragment } from "react";
import { getTranslations } from "next-intl/server";
import s from "./ConnectFacts.module.css";

type Fact = { title: string; body: string };

/** Catalog strings mark identifiers with backticks (`supalens_ro`); render them as code. */
function withCode(text: string) {
  return text.split("`").map((part, index) =>
    index % 2 === 1 ? <code key={index}>{part}</code> : <Fragment key={index}>{part}</Fragment>,
  );
}

/* Ink band (the home page's principles band): centered serif statement over the
   four things that actually happen on connect. Every claim is checked against the
   Supabase OAuth implementation (lib/supabase-oauth, lib/supabase-management): no
   database password is ever read, a per-project `supalens_ro` role is minted and
   only its credentials are stored, queries are SELECT-only in a READ ONLY
   transaction, and disconnecting drops the role and revokes the stored secret. */
export default async function ConnectFacts() {
  const t = await getTranslations("supabasePage");
  const facts = t.raw("after") as Fact[];

  return (
    <section id="after-connect" className={`ed-section ${s.band}`} aria-labelledby="after-connect-title">
      <div className="ed-container" data-reveal>
        <h2 id="after-connect-title" className={s.title}>
          {t("afterTitle")}
        </h2>
        <p className={s.lede}>{t("afterLede")}</p>
        <ol className={s.grid}>
          {facts.map((fact, index) => (
            <li key={fact.title} className={s.item}>
              <span className={s.kicker}>{String(index + 1).padStart(2, "0")}</span>
              <h3 className={s.name}>{fact.title}</h3>
              <p className={s.body}>{withCode(fact.body)}</p>
            </li>
          ))}
        </ol>
        <p className={s.note}>{t("projectNote")}</p>
      </div>
    </section>
  );
}
