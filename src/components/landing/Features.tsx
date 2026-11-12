import { getTranslations } from "next-intl/server";
import s from "./Features.module.css";

type T = Awaited<ReturnType<typeof getTranslations>>;

/* ============================================================
   Features — the three OUTCOMES (operator-first, 2026-09):
   01 Understand · 02 Build · 03 Watch. Was a six-card feature
   bento (NL→SQL, multi-DB routing, 12 chart types, alerts,
   digest, GitHub). The on-demand companions (Ask, MCP,
   dashboards, digest, email) survive as a subdued chip row —
   present, never a headline. Card text lives in `features.items`
   (merged by index); each card keeps a frosted mini-mock.
   ============================================================ */

type OutcomeKind = "understand" | "build" | "watch";

const OUTCOMES: OutcomeKind[] = ["understand", "build", "watch"];

function Vignette({ kind, t }: { kind: OutcomeKind; t: T }) {
  switch (kind) {
    // SUPALENS.md generated from the repo — the code-derived rules
    case "understand":
      return (
        <div className={s.vig}>
          <div className={s.win}>
            <div className={s.winBar}>
              <span className={s.winName}>SUPALENS.md</span>
              <span className={s.winBadge}>{t("vig.githubBadge")}</span>
            </div>
            <div className={s.winBody}>
              <code className={s.mdH}># orders</code>
              <code className={s.mdLine}>{t("vig.githubNote1")}</code>
              <code className={s.mdLine}>{t("vig.githubNote2")}</code>
            </div>
          </div>
        </div>
      );

    // KPI proposals — each row bound to SQL that actually ran
    case "build":
      return (
        <div className={s.vig}>
          <div className={s.kpiList}>
            <div className={s.kpiRow}>
              <span className={s.kpiName}>{t("vig.kpi1")}</span>
              <span className={s.kpiMeta}>{t("vig.kpiRows")}</span>
              <span className={s.kpiChip}>{t("vig.kpiVerified")}</span>
            </div>
            <div className={s.kpiRow}>
              <span className={s.kpiName}>{t("vig.kpi2")}</span>
              <span className={s.kpiMeta}>{t("vig.kpiRows")}</span>
              <span className={s.kpiChip}>{t("vig.kpiVerified")}</span>
            </div>
          </div>
        </div>
      );

    // a firing monitor + the investigation in progress
    case "watch":
      return (
        <div className={s.vig}>
          <div className={s.alertChip}>
            <span className={s.alertDot} />
            <span className={s.alertName}>{t("vig.alertMetric")}</span>
            <span className={s.alertDelta}>−18%</span>
          </div>
          <div className={s.alertHint}>
            <span className={s.spin} /> {t("vig.alertInvestigating")}
          </div>
        </div>
      );
  }
}

export default async function Features() {
  const t = await getTranslations("features");
  const items = t.raw("items") as Array<{ kicker: string; title: string; body: string }>;
  const secondary = t.raw("secondary") as string[];
  return (
    <section className="cx-section" id="features">
      <div className="cx-container">
        <div className={s.head}>
          <h2 className="cx-type-md">{t("heading")}</h2>
          <p className={`cx-type-md ${s.lede}`}>{t("lede")}</p>
        </div>

        <div className={s.grid}>
          {OUTCOMES.map((kind, i) => (
            <article key={kind} className={`cx-card ${s.tile}`}>
              <span className={s.index}>{items[i].kicker}</span>
              <h3 className={`cx-type-base ${s.title}`}>{items[i].title}</h3>
              <p className={`cx-type-sm ${s.body}`}>{items[i].body}</p>
              <Vignette kind={kind} t={t} />
            </article>
          ))}
        </div>

        {/* the on-demand companions — a chip row, deliberately not cards */}
        <div className={s.secondary}>
          <span className={s.secLabel}>{t("secondaryLabel")}</span>
          <div className={s.pillRow}>
            {secondary.map((label) => (
              <span key={label} className={s.pill}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
