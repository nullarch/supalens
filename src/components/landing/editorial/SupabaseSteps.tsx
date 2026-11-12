import { ArrowRight, Check, Github } from "lucide-react";
import { getTranslations } from "next-intl/server";
import DatabaseLogo from "@/components/brand/DatabaseLogo";
import s from "./SupabaseSteps.module.css";

type Step = { title: string; body: string };
type T = Awaited<ReturnType<typeof getTranslations<"steps">>>;

/* A sample state in the editorial grammar (as in SignalDemo): mono kicker over a
   white 14px inset. No window chrome or shadows. */
function Sample({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className={s.sample}>
      <p className={s.sampleKicker}>{name}</p>
      <div className={s.inset}>{children}</div>
    </div>
  );
}

function ConnectVisual({ t }: { t: T }) {
  return (
    <Sample name={t("demo.connect.name")}>
      <div className={s.row}>
        <DatabaseLogo name="supabase" size={15} className={s.rowMark} />
        <span className={s.rowLabel}>Supabase</span>
        <span className={s.chip}>{t("demo.connect.supabaseBtn")}</span>
      </div>
      <div className={s.row}>
        <Github size={15} className={s.rowMark} />
        <span className={s.rowLabel}>GitHub</span>
        <span className={s.chip}>{t("demo.connect.githubBtn")}</span>
      </div>
      <span className={s.status}>
        <i className={s.dot} />
        {t("demo.connect.synced")}
      </span>
    </Sample>
  );
}

function RulesVisual({ t }: { t: T }) {
  return (
    <Sample name={t("demo.rules.name")}>
      {(["r1", "r2", "r3"] as const).map((key) => (
        <div key={key} className={s.check}>
          <Check size={14} />
          <span>{t(`demo.rules.${key}`)}</span>
        </div>
      ))}
      <span className={s.code}>{t("demo.rules.evidence")}</span>
    </Sample>
  );
}

function KpiVisual({ t }: { t: T }) {
  return (
    <Sample name={t("demo.kpi.name")}>
      {(["k1", "k2", "k3"] as const).map((key) => (
        <div key={key} className={s.kpi}>
          <span className={s.box}>
            <Check size={11} strokeWidth={2.5} />
          </span>
          <span className={s.rowLabel}>{t(`demo.kpi.${key}`)}</span>
          <span className={s.verified}>{t("demo.kpi.verified")}</span>
        </div>
      ))}
      <span className={s.approve}>
        {t("demo.kpi.cta")}
        <ArrowRight size={13} />
      </span>
    </Sample>
  );
}

// Approved KPIs and monitors stay separate counts: not every approved KPI gets a monitor.
function MonitorVisual({ t }: { t: T }) {
  return (
    <Sample name={t("demo.monitor.name")}>
      <div className={s.counts}>
        <span>{t("demo.monitor.approved")}</span>
        <span className={s.countSep}>·</span>
        <span>{t("demo.monitor.monitors")}</span>
      </div>
      <div className={s.chips}>
        <span className={s.status}>
          <i className={s.dot} />
          Slack {t("demo.monitor.channel")}
        </span>
        <span className={s.chip}>{t("demo.monitor.next")}</span>
      </div>
    </Sample>
  );
}

const VISUALS = [ConnectVisual, RulesVisual, KpiVisual, MonitorVisual];

/* Section tag → serif heading → description, then the four steps as the home
   page's workflow cards (visual, number tag, 24px title, short copy) in a 2×2
   grid. The visuals are illustrative sample states. */
export default async function SupabaseSteps() {
  const t = await getTranslations("steps");
  const nav = await getTranslations("nav");
  const product = await getTranslations("globalProduct");
  const items = t.raw("items") as Step[];

  return (
    <section id="how" className="ed-section" aria-labelledby="how-title">
      <div className="ed-container" data-reveal>
        <header className="ed-head">
          <span className="ed-tag">{nav("howItWorks")}</span>
          <h2 id="how-title" className="ed-title">
            {t("heading")}
          </h2>
          <p className="ed-lede">{t("lede")}</p>
        </header>

        <ol className={s.grid}>
          {items.map((item, index) => {
            const Visual = VISUALS[index];
            return (
              <li key={item.title} className={s.card}>
                <div className={s.visual} aria-hidden>
                  <Visual t={t} />
                </div>
                <span className={`ed-tag ed-tag--small ed-tag--code ${s.number}`}>0{index + 1}</span>
                <h3 className={s.cardTitle}>{item.title}</h3>
                <p className={s.cardBody}>{item.body}</p>
              </li>
            );
          })}
        </ol>
        <p className={s.note}>
          {product("previewLabel")}. {product("sampleNote")}
        </p>
      </div>
    </section>
  );
}
