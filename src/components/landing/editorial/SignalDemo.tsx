import { getTranslations } from "next-intl/server";
import s from "./SignalDemo.module.css";

/* Monitoring sample in the editorial grammar — the reference's chart panel, not
   imitation Slack or mail screens. One pale panel divided by fine lines:

     signal (state, monitor, value, 14-day chart, metric/condition/source)
     | investigation (confirmed in data → likely driver)
     ─ delivery strip: Slack · mail · all-clear

   The content mirrors what the real notifications carry (lib/notify/slack.ts,
   lib/email/alert.ts). Facts wear the indigo tag, the AI hypothesis the bloom
   tag. Illustrative values, labeled as a sample; no live polling. */

// Daily revenue in ₩M over 14 days. The first 13 average ₩4.25M (the ₩4.2M
// baseline) and never cross the < ₩4.0M condition; today is ₩3.1M (−26%).
const DAYS = [4.3, 4.1, 4.4, 4.2, 4.5, 4.2, 4.3, 4.1, 4.4, 4.2, 4.3, 4.1, 4.2, 3.1];
const SCALE_MAX = 5;
const CONDITION = 4;

export default async function SignalDemo() {
  const t = await getTranslations("alertDemo");
  const alert = await getTranslations("emailAlert");
  const product = await getTranslations("globalProduct");
  const facts = t.raw("slack.facts") as string[];
  const condition = `< ₩${CONDITION.toFixed(1)}M`;

  return (
    <div className={`ed-panel ${s.panel}`}>
      <div role="group" aria-label={product("previewLabel")}>
        <div className={s.grid}>
          <div className={s.signal}>
            <p className={s.kickerState} data-state="fired">
              <span className={s.dot} aria-hidden />
              {alert("headingFired")}
              <span className={s.kickerTime}>{t("slack.time")}</span>
            </p>
            <h3 className={s.title}>{t("slack.alertTitle")}</h3>
            <p className={s.metric}>
              <span className={s.value}>₩3.1M</span>
              <span className={s.delta}>−26%</span>
              <span className={s.baseline}>{t("slack.baseline")}</span>
            </p>

            <div
              className={s.chart}
              role="img"
              aria-label={`${t("slack.alertTitle")}: ₩3.1M, ${t("slack.baseline")}, ${t("slack.metaCondition")} ${condition}`}
            >
              <p className={s.legend} aria-hidden>
                <span className={s.legendLine} />
                {t("slack.metaCondition")} {condition}
              </p>
              <div className={s.plot}>
                <span className={s.condition} style={{ bottom: `${(CONDITION / SCALE_MAX) * 100}%` }} />
                {DAYS.map((value, index) => (
                  <span
                    key={index}
                    className={s.bar}
                    data-today={index === DAYS.length - 1 || undefined}
                    style={{ height: `${(value / SCALE_MAX) * 100}%` }}
                    title={`₩${value.toFixed(1)}M`}
                  />
                ))}
              </div>
            </div>

            <dl className={s.meta}>
              <div>
                <dt>{t("slack.metaMetric")}</dt>
                <dd>
                  <code>daily_revenue</code>
                </dd>
              </div>
              <div>
                <dt>{t("slack.metaCondition")}</dt>
                <dd>{condition}</dd>
              </div>
              <div>
                <dt>{t("slack.metaSource")}</dt>
                <dd>{t("slack.sourceValue")}</dd>
              </div>
            </dl>
          </div>

          <div className={s.investigation}>
            <div className={s.block}>
              <span className="ed-tag ed-tag--small">{t("confirmedTag")}</span>
              <ul className={s.facts}>
                {facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            </div>
            <div className={s.block}>
              <span className="ed-tag ed-tag--small ed-tag--bloom">{t("likelyTag")}</span>
              <p className={s.cause}>{t("slack.likely")}</p>
            </div>
            <p className={s.attribution}>{t("attribution")}</p>
          </div>
        </div>

        <ol className={s.delivery}>
          <li className={s.channel}>
            <p className={s.kicker}>
              Slack · #alerts
              <span className={s.kickerTime}>{t("slack.time")}</span>
            </p>
            <p className={s.channelMain} data-state="fired">
              <span className={s.dot} aria-hidden />
              {alert("headingFired")}
            </p>
            <p className={s.channelSub}>{`${t("confirmedTag")} · ${t("likelyTag")}`}</p>
          </li>
          <li className={s.channel}>
            <p className={s.kicker}>
              {t("email.chromeTitle")}
              <span className={s.kickerTime}>{t("slack.time")}</span>
            </p>
            <p className={s.channelMain}>{t("email.subject")}</p>
            <p className={s.channelSub}>owner@dailycart.co.kr</p>
          </li>
          <li className={s.channel}>
            <p className={s.kicker}>
              {t("recoveryLabel")}
              <span className={s.kickerTime}>{t("recoveryTime")}</span>
            </p>
            <p className={s.channelMain} data-state="resolved">
              <span className={s.dot} aria-hidden />
              {alert("headingResolved")}
            </p>
            <p className={s.channelSub}>{alert("bodyResolved", { value: "₩4.3M" })}</p>
          </li>
        </ol>
      </div>

      <p className={s.note}>{product("sampleNote")}</p>
    </div>
  );
}
