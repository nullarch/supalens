import { getTranslations } from "next-intl/server";
import s from "./SchemaVsCode.module.css";

const SCHEMA_ONLY_SQL = "subscriptions.status = 'active'";

// The code-derived predicate: the first line is all the schema suggests, the rest
// are the rules the repository enforces (marked as additions).
const CODE_SQL: { text: string; added: boolean }[] = [
  { text: "status = 'active'", added: false },
  { text: "AND deleted_at IS NULL", added: true },
  { text: "AND trial = false", added: true },
  { text: "AND payment_status = 'paid'", added: true },
  { text: "AND internal_account = false", added: true },
];

/* "Your schema isn't your business logic." The same question — active
   subscriptions — answered from the schema alone and from what the code says,
   in one pale panel split by a hairline. Like the reference's comparison chart,
   the other value is muted and Supalens' value carries the accent. The numbers
   are illustrative sample values, labeled as such. */
export default async function SchemaVsCode() {
  const t = await getTranslations("schemaOnly");
  const product = await getTranslations("globalProduct");

  return (
    <section id="why-code" className="ed-section" aria-labelledby="why-code-title">
      <div className="ed-container" data-reveal>
        <header className="ed-head">
          <span className="ed-tag">{t("kicker")}</span>
          <h2 id="why-code-title" className="ed-title">
            {t("heading")}
          </h2>
          <p className="ed-lede">{t("lede")}</p>
        </header>

        <div className={`ed-panel ${s.panel}`}>
          <div className={s.compare}>
            <article className={s.side}>
              <h3 className={s.label}>{t("left.label")}</h3>
              <pre className={s.code} tabIndex={0} aria-label={t("left.label")}>
                <code>{SCHEMA_ONLY_SQL}</code>
              </pre>
              <p className={s.result}>
                <span className={s.resultLabel}>{t("left.result")}</span>
                <span className={s.value}>{t("left.value")}</span>
              </p>
            </article>

            <article className={`${s.side} ${s.fromCode}`}>
              <h3 className={s.label}>{t("right.label")}</h3>
              <pre className={s.code} tabIndex={0} aria-label={t("right.label")}>
                <code>
                  {CODE_SQL.map((line) => (
                    <span key={line.text} className={line.added ? s.added : s.line}>
                      {line.text}
                    </span>
                  ))}
                </code>
              </pre>
              <p className={s.result}>
                <span className={s.resultLabel}>{t("right.result")}</span>
                <span className={s.value}>{t("right.value")}</span>
                <span className={`ed-tag ed-tag--small ed-tag--neutral ed-tag--code ${s.evidence}`}>
                  {t("right.evidence")}
                </span>
              </p>
            </article>
          </div>
          <p className={s.note}>{product("sampleNote")}</p>
        </div>

        <div className={s.conclusion}>
          <p className={s.caption}>{t("caption")}</p>
          <p className={s.body}>{t("body")}</p>
        </div>
      </div>
    </section>
  );
}
