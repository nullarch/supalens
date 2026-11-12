import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PageHead } from "@/components/dashboard/PageHead";
import { ArrowRight, StateDot, TierChip } from "./Bits";
import type { BusinessModelRow } from "./data";
import { contextTimestamp } from "./presentation";
import s from "./business-model.module.css";

/** Shared presentation; authenticated source/context loading remains in page.tsx. */
export function BusinessModelIndex({ rows }: { rows: BusinessModelRow[] }) {
  const t = useTranslations("appBusinessModel");
  const locale = useLocale();
  const real = rows.filter((r) => !r.isDemo);
  const demo = rows.filter((r) => r.isDemo);

  const renderRow = (row: BusinessModelRow) => {
    const hasDoc = row.counts != null;
    const counts: string[] = [];
    if (row.counts) {
      counts.push(t("counts.entities", { count: row.counts.entities }));
      counts.push(t("counts.rules", { count: row.counts.rules }));
      if (row.counts.metrics > 0) counts.push(t("counts.metrics", { count: row.counts.metrics }));
    }
    const generated = contextTimestamp(row.generatedAt, locale);

    return (
      <li key={row.id}>
        {/* No doc yet → the generation lives on the source card, so send the user there. */}
        <Link href={hasDoc ? `/app/business-model/${row.id}` : "/app/sources"} className={s.source} data-doc={hasDoc}>
          <span className={s.sourceMain}>
            <span className={s.sourceName}>{row.name}</span>
            {generated ? (
              <time className={s.sourceTime} dateTime={generated.iso}>
                {t("generatedAt", { date: generated.label })}
              </time>
            ) : row.generatedAt ? (
              <span className={s.sourceTime}>{t("changes.timeUnavailable")}</span>
            ) : null}
          </span>
          <span className={s.sourceCounts}>
            {counts.map((c) => (
              <span key={c} className={s.sourceCount}>
                {c}
              </span>
            ))}
          </span>
          <span className={s.sourceState}>
            <StateDot state={row.state} label={t(`state.${row.state}`)} />
          </span>
          <span className={s.sourceTier}>
            {row.tier ? (
              <TierChip tier={row.tier} label={t(`tier.${row.tier}`)} />
            ) : (
              !hasDoc && <span className={s.sourceGenerate}>{t("generate")}</span>
            )}
          </span>
          <span className={s.sourceArrow}>
            <ArrowRight />
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className={s.wrap}>
      <PageHead title={t("title")} subtitle={t("subtitle")} />

      {rows.length === 0 ? (
        <div className={s.emptyIndex}>
          <p className={s.emptyTitle}>{t("empty")}</p>
          <Link href="/app/sources" className="dx-btn">
            {t("emptyCta")}
          </Link>
        </div>
      ) : (
        <>
          {real.length > 0 && <ul className={s.sources}>{real.map(renderRow)}</ul>}
          {demo.length > 0 && (
            <section className={s.sampleGroup}>
              <h2 className={`dx-section-title ${s.groupLabel}`}>{t("sampleGroup")}</h2>
              <ul className={s.sources}>{demo.map(renderRow)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
