import { Check, CircleAlert, LayoutGrid, Radar, Search, ShieldCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import s from "./ProductPreview.module.css";

/** Sample Supalens overview in the real product typeface and app tokens.
 * Explicitly labeled sample data with no data IO; the live demo and the
 * workspace render their own real data and actions. */
export default async function ProductPreview() {
  const t = await getTranslations("globalProduct");
  const format = await getFormatter();
  const monitors = [
    { key: "access", value: t("orders", { count: 3 }), issue: true },
    { key: "jobs", value: format.number(0.004, { style: "percent", maximumFractionDigits: 1 }), issue: false },
    { key: "conversion", value: format.number(0.082, { style: "percent", maximumFractionDigits: 1 }), issue: false },
  ];

  return (
    <div className={`ed-product ${s.window}`}>
      <aside className={s.sidebar} aria-hidden>
        <div className={s.workspace}>
          <span>A</span>
          <div>
            Acme<small>{t("sampleWorkspace")}</small>
          </div>
        </div>
        <div className={s.navGroup}>
          <span className={s.navActive}>
            <LayoutGrid size={14} />
            {t("overview")}
          </span>
          <span>
            <Radar size={14} />
            {t("monitors")}
          </span>
          <span>
            <Search size={14} />
            {t("investigation")}
          </span>
        </div>
        <div className={s.sources}>
          <span>Supabase</span>
          <span>GitHub</span>
        </div>
        <span className={s.readOnly}>
          <ShieldCheck size={12} />
          {t("readOnly")}
        </span>
      </aside>

      <div className={s.main}>
        <div className={s.breadcrumb}>
          {t("sampleWorkspace")}
          <span>/</span>
          <strong>{t("overview")}</strong>
        </div>
        <div className={s.content}>
          <h2>{t("overviewTitle")}</h2>
          <p className={s.overviewSub}>{t("overviewSub")}</p>
          <div className={s.signal}>
            <CircleAlert size={17} aria-hidden />
            <div>
              <strong>{t("signalTitle")}</strong>
              <p>{t("signalDescription")}</p>
            </div>
          </div>
          <dl className={s.metrics}>
            <div>
              <dt>{t("active")}</dt>
              <dd>3</dd>
            </div>
            <div>
              <dt>{t("healthy")}</dt>
              <dd>2</dd>
            </div>
            <div>
              <dt>{t("attention")}</dt>
              <dd className={s.negative}>1</dd>
            </div>
          </dl>
          <div className={s.grid}>
            <section className={s.monitors} aria-labelledby="sample-monitors-title">
              <h3 id="sample-monitors-title">{t("priority")}</h3>
              <div>
                {monitors.map((monitor) => (
                  <div key={monitor.key} className={s.row}>
                    <div className={s.monitorName}>{t(`monitor.${monitor.key}`)}</div>
                    <span className={s.monitorValue}>{monitor.value}</span>
                    <span className={monitor.issue ? s.issue : s.healthy}>
                      {monitor.issue ? <CircleAlert size={11} aria-hidden /> : <Check size={11} aria-hidden />}
                      {t(monitor.issue ? "issue" : "healthy")}
                    </span>
                  </div>
                ))}
              </div>
              <p className={s.sampleNote}>{t("sampleNote")}</p>
            </section>
            <section className={s.investigation} aria-labelledby="sample-investigation-title">
              <span className={s.investigationLabel}>
                <Search size={13} aria-hidden />
                {t("investigation")}
              </span>
              <h3 id="sample-investigation-title">{t("investigationTitle")}</h3>
              <p>{t("investigationDescription")}</p>
              <div className={s.evidence}>
                <span>{t("confirmed")}</span>
                <p>
                  <Check size={12} aria-hidden />
                  {t("factPayment")}
                </p>
                <p>
                  <Check size={12} aria-hidden />
                  {t("factAccess")}
                </p>
              </div>
              <details className={s.nextCheck}>
                <summary>
                  {t("nextCheck")}
                  <span aria-hidden>+</span>
                </summary>
                <p>{t("hypothesis")}</p>
              </details>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
