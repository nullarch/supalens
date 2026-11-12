import { Check, Minus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import DatabaseLogo, { DATABASES } from "@/components/brand/DatabaseLogo";
import s from "./Connections.module.css";

type Capability = "questions" | "kpis" | "monitors";

// What each source supports today. KPI extraction and monitors run through the SQL engine
// (api/data-sources/[id]/kpis/extract, alerts/actions isSqlEngine); Firestore answers questions only.
const SUPPORT: Record<(typeof DATABASES)[number]["key"], Record<Capability, boolean>> = {
  supabase: { questions: true, kpis: true, monitors: true },
  postgresql: { questions: true, kpis: true, monitors: true },
  mysql: { questions: true, kpis: true, monitors: true },
  firestore: { questions: true, kpis: false, monitors: false },
};
const CAPABILITIES: Capability[] = ["questions", "kpis", "monitors"];

/* One pale panel split into four source columns, like the reference's model library row:
   logo, name, how it connects and exactly what works. */
export default async function Connections() {
  const t = await getTranslations("connections");

  return (
    <section id="connections" className="ed-section" aria-labelledby="connections-title">
      <div className="ed-container" data-reveal>
        <header className="ed-head">
          <span className="ed-tag">{t("tag")}</span>
          <h2 id="connections-title" className="ed-title">
            {t("title")}
          </h2>
          <p className="ed-lede">{t("lede")}</p>
        </header>

        <ul className={`ed-panel ${s.panel}`}>
          {DATABASES.map((db) => (
            <li key={db.key} className={s.source} style={{ "--source-color": db.color } as React.CSSProperties}>
              <DatabaseLogo name={db.key} size={30} className={s.logo} />
              <h3 className={s.name}>{db.name}</h3>
              <p className={s.method}>{t(`methods.${db.key}`)}</p>
              <ul className={s.capabilities}>
                {CAPABILITIES.map((capability) => {
                  const supported = SUPPORT[db.key][capability];
                  return (
                    <li key={capability} data-supported={supported}>
                      {supported ? <Check size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
                      <span>{t(`capabilities.${capability}`)}</span>
                      <span className="sr-only">{supported ? t("supported") : t("notSupported")}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <p className={s.note}>{t("note")}</p>
      </div>
    </section>
  );
}
