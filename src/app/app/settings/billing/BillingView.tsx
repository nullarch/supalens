import { getTranslations, getLocale } from "next-intl/server";
import type { BillingSummary } from "@/lib/plans/summary";
import { formatMoney } from "@/lib/paddle/money";
import { PLAN_PRICE_USD, formatLimit, isUnlimited } from "@/lib/plans/limits";
import { effectiveCheckInterval } from "@/lib/alerts/evaluate";
import { PlanActions } from "@/components/billing/PlanActions";
import { PlanCards } from "@/components/billing/PlanCards";
import { PageHead } from "@/components/dashboard/PageHead";
import s from "./billing.module.css";

function pct(used: number, limit: number): number {
  if (isUnlimited(limit) || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}


/** Presentation only. Auth, billing reconciliation and data loading stay in the route. */
export async function BillingView({ summary, billingConfigured, yearlyAvailable, adminTestAvailable = false }: {
  summary: BillingSummary; billingConfigured: boolean; yearlyAvailable: boolean; adminTestAvailable?: boolean;
}) {
  const t = await getTranslations("appBilling");
  const locale = await getLocale();
  const intlLocale = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : "en-US";
  const { plan, effectivePlan, usage, limits, transactions, subscriptionStatus, periodStart, periodEnd, scheduledChange, hasBilling, overage } =
    summary;
  const price = PLAN_PRICE_USD[plan];

  const statusLabel: Record<string, string> = {
    active: t("status.active"),
    trialing: t("status.trialing"),
    past_due: t("status.pastDue"),
    paused: t("status.paused"),
    canceled: t("status.canceled"),
  };
  const txStatusLabel: Record<string, string> = {
    completed: t("txStatus.completed"),
    paid: t("txStatus.paid"),
    billed: t("txStatus.billed"),
    refunded: t("txStatus.refunded"),
    chargeback: t("txStatus.chargeback"),
    past_due: t("txStatus.pastDue"),
    canceled: t("txStatus.canceled"),
  };

  // banner subline: free plans NEVER show a billing date (their window is a usage period,
  // not an invoice date); paid plans show scheduled change > trial end > next bill.
  const dateOf = (iso: string) => iso.slice(0, 10);
  let subline: string | null;
  if (plan === "free") {
    subline = t("freeNoBill");
  } else if (scheduledChange?.effective_at) {
    const date = dateOf(scheduledChange.effective_at);
    subline =
      scheduledChange.action === "cancel"
        ? t("scheduled.cancel", { date })
        : scheduledChange.action === "pause"
          ? t("scheduled.pause", { date })
          : scheduledChange.action === "resume"
            ? t("scheduled.resume", { date })
            : t("scheduled.change", { date });
  } else if (subscriptionStatus === "trialing" && periodEnd) {
    subline = t("trialEnds", { date: dateOf(periodEnd) });
  } else if (periodEnd) {
    subline = t("nextBill", { date: dateOf(periodEnd) });
  } else {
    subline = null;
  }

  const dunningNotice =
    subscriptionStatus === "past_due" ? t("pastDueNotice") : subscriptionStatus === "paused" ? t("pausedNotice") : null;

  // Monitoring is the plan's value unit; questions are a fair-use allowance and go last.
  const usageRows: Array<{ label: string; used: number; limit: number; fmt: (n: number) => string }> = [
    { label: t("usage.alerts"), used: usage.alerts, limit: limits.alerts_per_org, fmt: (n) => String(n) },
    { label: t("usage.connections"), used: usage.connections, limit: limits.database_connections, fmt: (n) => String(n) },
    { label: t("usage.members"), used: usage.members, limit: limits.team_members, fmt: (n) => String(n) },
    { label: t("usage.dashboards"), used: usage.dashboards, limit: limits.dashboards, fmt: (n) => String(n) },
    { label: t("usage.queries"), used: usage.queries, limit: limits.queries_per_month, fmt: (n) => n.toLocaleString(intlLocale) },
  ];
  const cadenceSec = effectiveCheckInterval(limits.alert_min_check_interval);
  const cadenceLabel =
    cadenceSec >= 3600
      ? t("cadence.hours", { n: Math.round(cadenceSec / 3600) })
      : t("cadence.minutes", { n: Math.round(cadenceSec / 60) });

  const monitors = usageRows[0];
  const monitorPct = pct(monitors.used, monitors.limit);

  return (
    <div className={s.page}>
      <PageHead title={t("title")} subtitle={t("subtitle")} />

      {/* the current plan and the figures that define it */}
      <section className={s.banner} aria-labelledby="billing-plan-title">
        <div className={s.bandMain}>
          <div className={s.bandText}>
            <span className={s.bandLabel}>{t("currentPlan")}</span>
            <div className={s.planRow}>
              <h2 id="billing-plan-title" className={s.planName}>{t(`plans.${plan}`)}</h2>
              {subscriptionStatus ? (
                <span className={`dx-badge ${subscriptionStatus === "past_due" ? "dx-badge-error" : subscriptionStatus === "paused" || subscriptionStatus === "canceled" ? "dx-badge-warning" : subscriptionStatus === "trialing" ? "dx-badge-clay" : "dx-badge-success"}`}>
                  {statusLabel[subscriptionStatus] ?? subscriptionStatus}
                </span>
              ) : null}
            </div>
            {subline ? <span className={s.subline}>{subline}</span> : null}
            {dunningNotice ? <span className={s.dunning} data-status={subscriptionStatus}>{dunningNotice}</span> : null}
          </div>
          <div className={s.bannerActions}>
            <PlanActions plan={plan} hasBilling={hasBilling} />
          </div>
        </div>
        <dl className={s.figures}>
          <div>
            <dt>{t("figures.price")}</dt>
            <dd>
              {price > 0 ? <>${price}<small>{t("perMonth")}</small></> : t("free")}
            </dd>
          </div>
          <div>
            <dt>{monitors.label}</dt>
            <dd>
              {monitors.fmt(monitors.used)}<small>/ {formatLimit(monitors.limit, t("unlimited"), intlLocale)}</small>
            </dd>
            {isUnlimited(monitors.limit) ? null : (
              <span className={s.bandMeter} aria-hidden>
                <span style={{ width: `${monitorPct}%` }} data-high={monitorPct >= 80} />
              </span>
            )}
          </div>
          <div>
            <dt>{t("cadence.label")}</dt>
            <dd>{cadenceLabel}</dd>
          </div>
          <div>
            <dt>{t("figures.period")}</dt>
            <dd className={s.figurePeriod}>
              {periodStart && periodEnd ? <>{periodStart.slice(0, 10)}<span aria-hidden> → </span><span className="sr-only"> ~ </span>{periodEnd.slice(0, 10)}</> : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <div className={s.cols}>
        {/* usage */}
        <section className={s.section} aria-labelledby="billing-usage-title">
          <div className={s.sectionHead}>
            <h2 id="billing-usage-title" className={s.sectionTitle}>{t("usageTitle")}</h2>
            {periodStart && periodEnd ? (
              <span className={s.cycle}>
                {periodStart.slice(0, 10)} ~ {periodEnd.slice(0, 10)}
              </span>
            ) : null}
          </div>
          <div className={s.usagePanel}>
            {effectivePlan !== plan ? <p className={s.limitsReduced}>{t("limitsReduced")}</p> : null}
            <ul className={s.usage}>
              {usageRows.map((u) => (
                <li key={u.label} className={s.usageRow}>
                  <div className={s.usageTop}>
                    <span className={s.usageLabel}>{u.label}</span>
                    <span className={s.usageVal}>
                      {u.fmt(u.used)} <span className={s.usageMax}>/ {formatLimit(u.limit, t("unlimited"), intlLocale)}</span>
                    </span>
                  </div>
                  {isUnlimited(u.limit) ? null : (
                    <div
                      className={`dx-meter ${s.meter}`}
                      role="progressbar"
                      aria-label={u.label}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct(u.used, u.limit)}
                    >
                      <span className="dx-meter-fill" data-high={pct(u.used, u.limit) >= 80} style={{ width: `${pct(u.used, u.limit)}%` }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className={s.usageNote}>
              {t("fairUse")}
            </p>
            {overage?.enabled && (
              <div className={s.overage} data-state={overage.queries > 0 ? "exceeded" : "available"}>
                {overage.queries > 0
                  ? t.rich("overage.exceeded", {
                      count: overage.queries.toLocaleString(intlLocale),
                      est: overage.estUsd.toFixed(2),
                      rate: overage.ratePerQueryUsd,
                      b: (c) => <strong className={s.em}>{c}</strong>,
                      muted: (c) => <span className={s.muted}>{c}</span>,
                    })
                  : t.rich("overage.available", {
                      rate: overage.ratePerQueryUsd,
                      b: (c) => <strong className={s.em}>{c}</strong>,
                    })}
              </div>
            )}
          </div>
        </section>

        {/* transactions */}
        <section className={s.section} aria-labelledby="billing-transactions-title">
          <div className={s.sectionHead}>
            <h2 id="billing-transactions-title" className={s.sectionTitle}>{t("transactionsTitle")}</h2>
          </div>
          {transactions.length === 0 ? (
            <p className={s.emptyTx}>{t("noTransactions")}</p>
          ) : (
            <div className={s.tableCard}>
              <div className={s.tableWrap} role="region" aria-label={t("transactionsTitle")} tabIndex={0}>
                <table className={`dx-table ${s.table}`}>
                  <thead>
                    <tr>
                      <th>{t("table.date")}</th>
                      <th className={s.thAmount}>{t("table.amount")}</th>
                      <th>{t("table.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((txn) => (
                      <tr key={txn.id}>
                        <td className={s.txDate}>{txn.date ? txn.date.slice(0, 10) : "—"}</td>
                        <td className={s.txAmt}>{formatMoney(txn.amountCents, txn.currency, intlLocale)}</td>
                        <td>
                          <span className={`dx-badge ${txn.status === 'paid' || txn.status === 'completed' ? 'dx-badge-success' : txn.status === 'past_due' || txn.status === 'chargeback' ? 'dx-badge-error' : ''}`}>{txn.status ? (txStatusLabel[txn.status] ?? txn.status) : "—"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* plan comparison + upgrade */}
      <PlanCards
        currentPlan={plan}
        billingConfigured={billingConfigured}
        yearlyAvailable={yearlyAvailable}
        adminTestAvailable={adminTestAvailable}
      />

      <p className={s.footNote}>{t("footNote")}</p>
    </div>
  );
}
