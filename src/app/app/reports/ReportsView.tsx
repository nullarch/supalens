import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Activity, ArrowRight, Bell, House, LayoutGrid, TriangleAlert } from "lucide-react";

import DatabaseLogo from "@/components/brand/DatabaseLogo";
import { durationParts } from "@/lib/alerts/incidents";
import type { Report } from "@/lib/reports/build";
import { ReportFeed } from "./ReportFeed";
import { ServiceSwitcher } from "./ServiceSwitcher";
import type { MonitorHealthState, OverviewMonitor, OverviewService } from "./workspace";
import s from "./board.module.css";

/* ============================================================
   Reports — the report archive (/app/reports). Supalens files reports the way
   an operations lead would: urgent reports when a metric leaves its range,
   recovery follow-ups, a daily and a weekly report, and analysis reports as
   each service (data source) is understood (lib/reports/build — every report
   is derived from real records).

     main   "Needs you" shelf → report log by day (ReportFeed, client)
     rail   service status (all services) or the one service in full,
            the last seven days, quick links

   ?source=<id> scopes the reports to one service. The overview (the home
   dashboard) shows only the decisions and today's line from these reports.
   ============================================================ */

export interface ReportsViewProps {
  view: "all" | "single";
  /** The service shown in full (single view). */
  focusId: string | null;
  /** Real (non-demo) data sources. */
  services: OverviewService[];
  /** Owner/admin/member — viewers read, they don't connect or approve. */
  canManage: boolean;
  intervalMin: number;
  /** Already scoped to the focused service in the single view. */
  reports: Report[];
  /** The clock the reports were built with. */
  now: number;
  timeZone: string;
  orgId: string;
  /** Incident acknowledgement columns exist (the ack migration is applied). */
  ackReady: boolean;
}

const shortAgo = (min: number) =>
  min >= 60 * 24 ? `${Math.round(min / 60 / 24)}d` : min >= 60 ? `${Math.round(min / 60)}h` : `${min}m`;

const HISTORICAL: ReadonlyArray<MonitorHealthState> = ["error", "paused", "pending"];

/**
 * The report archive's presentation, split from the page so the dev gallery can mount every
 * stage and view with fixtures. Pure props in — no io.
 */
export async function ReportsView(p: ReportsViewProps) {
  const t = await getTranslations("appOverview");
  const ti = await getTranslations("appIncidents");
  const h = (key: string, values?: Record<string, string | number>) => t(`home.${key}`, values);
  const rt = (key: string, values?: Record<string, string | number>) => t(`reports.${key}`, values);

  const focus = p.view === "single" ? p.services.find((svc) => svc.id === p.focusId) ?? p.services[0] ?? null : null;
  const actionCount = p.reports.filter((x) => x.needsAction).length;

  const stateLabel = (m: OverviewMonitor) =>
    m.health === "incident" ? t("board.stateIncident")
      : m.health === "error" ? t("board.stateError")
        : m.health === "paused" ? t("board.statePaused")
          : m.health === "pending" ? t("board.statePending")
            : t("board.stateHealthy");
  const stateTag = (m: OverviewMonitor) =>
    m.health === "incident" ? "dx-badge dx-badge-error"
      : m.health === "error" ? "dx-badge dx-badge-warning"
        : m.health === "healthy" ? "dx-badge dx-badge-success" : "dx-badge";

  const operatingLinks = [
    { href: "/app/overview", label: rt("page.homeLink"), icon: House },
    { href: "/app/dashboards", label: h("links.reports"), icon: LayoutGrid },
    { href: "/app/monitors", label: h("links.monitors"), icon: Activity },
    // the incidents queue is the 감시 screen's second view (src/app/app/monitors/view.ts), not a route
    { href: "/app/monitors?view=incidents", label: h("links.incidents"), icon: TriangleAlert },
    { href: "/app/settings/notifications", label: h("links.notifications"), icon: Bell },
  ];

  /* ---------------- title row ---------------- */
  const switcher = p.services.length >= 2 && (
    <ServiceSwitcher
      label={h("switcher.label")}
      placeholder={h("switcher.pick")}
      all={{ key: "all", label: h("switcher.all"), href: "/app/reports?view=all", current: p.view === "all" }}
      services={p.services.map((svc) => ({ key: svc.id, label: svc.name, href: `/app/reports?source=${svc.id}`, current: p.view === "single" && focus?.id === svc.id }))}
    />
  );
  const lede = focus
    ? rt("ledeScoped", { service: focus.name, total: p.reports.length, action: actionCount })
    : p.services.length > 0 ? rt("lede", { total: p.reports.length, action: actionCount }) : null;
  const header = (
    <header className="dx-page-head">
      <div>
        <h1 className="dx-title">{rt("page.title")}</h1>
        {lede && <p className="dx-sub">{lede}</p>}
      </div>
      {switcher && <div className={`dx-head-actions ${s.headActions}`}>{switcher}</div>}
    </header>
  );

  /* ================= nothing connected: no records to report from ================= */
  if (p.services.length === 0) {
    return (
      <div className={s.page} data-view="empty" data-page-width="wide">
        {header}
        <section className={s.reportsEmpty}>
          <p>{rt("page.empty")}</p>
          <Link href="/app/sources" className="dx-btn dx-btn-sm">{rt("page.emptyCta")}</Link>
        </section>
      </div>
    );
  }

  /* ================= board: report inbox + service rail ================= */
  const badgeOf = (svc: OverviewService): { label: string; className: string } => {
    if (svc.recovery === "reconnect") return { label: h("all.stage.reconnect"), className: "dx-badge dx-badge-error" };
    if (svc.recovery === "scan_failed") return { label: h("all.stage.scanFailed"), className: "dx-badge dx-badge-error" };
    switch (svc.stage) {
      case "operating":
        return svc.board === "firing" ? { label: h("all.stage.firing", { count: svc.firingCount }), className: "dx-badge dx-badge-error" }
          : svc.board === "degraded" ? { label: h("all.stage.degraded", { count: svc.erroredCount }), className: "dx-badge dx-badge-warning" }
            : svc.board === "pending" ? { label: h("all.stage.pending", { count: svc.pendingCheckCount }), className: "dx-badge" }
              : { label: h("all.stage.normal"), className: "dx-badge dx-badge-success" };
      case "first_check": return { label: h("all.stage.firstCheck"), className: "dx-badge" };
      case "paused": return { label: h("all.stage.paused"), className: "dx-badge dx-badge-warning" };
      case "analyzing": return { label: h("all.stage.analyzing"), className: "dx-badge dx-badge-clay" };
      case "proposals": return { label: h("all.stage.proposals", { count: svc.pendingCount }), className: "dx-badge dx-badge-bloom" };
      case "extract": return { label: h("all.stage.extract"), className: "dx-badge" };
    }
  };

  /** The one next step for a service that is not operating yet. */
  const nextOf = (svc: OverviewService): { lead: string; note: string; cta?: { label: string; href: string; primary?: boolean; manage?: boolean } } | null => {
    switch (svc.stage) {
      case "analyzing": return { lead: h("banner.analyzing"), note: h("banner.analyzingNote") };
      case "proposals": return { lead: h("banner.proposals", { count: svc.pendingCount }), note: h("banner.proposalsNote"), cta: { label: h("cards.review.cta"), href: svc.kpiHref, primary: true, manage: true } };
      case "extract": return { lead: h("banner.extract"), note: h("banner.extractNote"), cta: { label: h("cards.extract.cta"), href: svc.kpiHref, primary: true, manage: true } };
      case "paused": return { lead: h("banner.paused"), note: h("banner.pausedNote"), cta: { label: h("banner.pausedCta"), href: "/app/monitors" } };
      case "first_check": return { lead: h("banner.firstCheck", { count: svc.monitorCount }), note: h("banner.firstCheckNote", { minutes: Math.max(1, svc.nextMin || p.intervalMin) }) };
      default: return null;
    }
  };

  const renderServiceCard = (svc: OverviewService) => {
    const badge = badgeOf(svc);
    const next = nextOf(svc);
    const rows = svc.monitors.slice(0, 3);
    return (
      <article key={svc.id} className={s.service} data-stage={svc.stage} data-board={svc.board} aria-labelledby={`service-${svc.id}`}>
        <header className={s.serviceHead}>
          <span className={s.serviceLogo}><DatabaseLogo name={svc.engine} size={18} /></span>
          <h2 id={`service-${svc.id}`} className={s.serviceName}>
            <Link href={`/app/reports?source=${svc.id}`} className={s.serviceLink}>{svc.name}</Link>
          </h2>
          <span className={badge.className}>{badge.label}</span>
          {/* Only watched services have a check cadence; a paused one says so in its badge. */}
          {svc.monitorCount > 0 && (
            <span className={s.serviceChecked}>
              {svc.checkedAgo == null ? h("all.checkedNever") : `${h("all.lastCheck")} ${h("table.ago", { value: shortAgo(svc.checkedAgo) })}`}
            </span>
          )}
          <Link href={`/app/reports?source=${svc.id}`} className={`dx-text-link ${s.serviceOpen}`} tabIndex={-1} aria-hidden>
            {h("all.open")} <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
          </Link>
        </header>

        {svc.recovery && (
          <p className={s.serviceAlert} role="alert">
            <span className={s.dot} data-tone="negative" aria-hidden />
            {svc.recovery === "reconnect" ? h("recovery.reconnect", { count: svc.brokenCount }) : h("recovery.scanFailed")}
            {p.canManage && (
              <Link href={svc.recovery === "reconnect" ? svc.reconnectHref : "/app/setup"} className={s.serviceAlertLink}>
                {svc.recovery === "reconnect" ? h("recovery.reconnectCta") : h("recovery.scanFailedCta")}
              </Link>
            )}
          </p>
        )}

        {svc.monitorTotal > 0 && (
          <dl className={s.serviceFigures}>
            <div><dt>{t("summary.active")}</dt><dd data-figure>{svc.monitorCount}</dd></div>
            <div><dt><span className="dx-dot dx-dot-attention" aria-hidden />{t("summary.firing")}</dt><dd data-tone={svc.firingCount ? "negative" : undefined} data-figure>{svc.firingCount}</dd></div>
            <div><dt><span className="dx-dot dx-dot-warning" aria-hidden />{t("summary.failed")}</dt><dd data-tone={svc.erroredCount ? "warning" : undefined} data-figure>{svc.erroredCount}</dd></div>
          </dl>
        )}

        {next && (
          <div className={s.serviceNext}>
            <p className={s.serviceNextText}>
              <span className={s.lead}>{next.lead}</span> <span className={s.note}>{next.note}</span>
            </p>
            {next.cta && (!next.cta.manage || p.canManage) && (
              <Link href={next.cta.href} className={next.cta.primary ? "dx-btn dx-btn-sm" : "dx-btn-ghost dx-btn-sm"}>{next.cta.label}</Link>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <ul className={s.serviceRows}>
            {rows.map((m) => (
              <li key={m.id} className={s.serviceRow} data-state={m.health}>
                <Link href={`/app/monitors/${m.id}`} className={s.rowLink}>{m.name}</Link>
                <span className={stateTag(m)}>{stateLabel(m)}</span>
                <span className={s.value}>{HISTORICAL.includes(m.health) ? "—" : m.value ?? "—"}</span>
              </li>
            ))}
            {svc.monitorTotal > rows.length && (
              <li className={s.serviceMore}>
                <Link href={`/app/reports?source=${svc.id}`}>{h("all.more", { count: svc.monitorTotal - rows.length })}</Link>
              </li>
            )}
          </ul>
        )}
      </article>
    );
  };

  // The last seven daily reports, summed: what the rail's "Last 7 days" figures show.
  const recent = p.reports
    .filter((x) => x.type === "daily" && x.totals)
    .reduce(
      (acc, x) => ({
        days: acc.days + 1,
        fired: acc.fired + x.totals!.fired,
        resolved: acc.resolved + x.totals!.resolved,
        resolvedMs: acc.resolvedMs + (x.totals!.mttrMs ?? 0) * x.totals!.resolved,
      }),
      { days: 0, fired: 0, resolved: 0, resolvedMs: 0 },
    );
  const mttr = recent.resolved > 0
    ? (() => {
        const { unit, n } = durationParts(recent.resolvedMs / recent.resolved);
        return ti(`duration.${unit}`, { n });
      })()
    : "—";

  return (
    <div className={s.page} data-view={focus ? "single" : "all"} data-page-width="wide">
      {header}
      <div className={s.board}>
        <div className={s.boardMain}>
          <ReportFeed reports={p.reports} orgId={p.orgId} timeZone={p.timeZone} now={p.now} canManage={p.canManage} ackReady={p.ackReady} />
        </div>

        <aside className={s.rail} aria-label={rt("rail.services")}>
          {focus ? (
            renderServiceCard(focus)
          ) : (
            <section className={s.railCard} aria-labelledby="reports-rail-services">
              <h2 id="reports-rail-services" className={s.railTitle}>
                {rt("rail.services")}
                <span className={s.railCount}>{p.services.length}</span>
              </h2>
              <ul className={s.railList}>
                {p.services.map((svc) => {
                  const badge = badgeOf(svc);
                  return (
                    <li key={svc.id}>
                      <Link href={`/app/reports?source=${svc.id}`} className={s.railService} data-stage={svc.stage} data-board={svc.board}>
                        <span className={s.railLogo} aria-hidden><DatabaseLogo name={svc.engine} size={16} /></span>
                        <span className={s.railName}>{svc.name}</span>
                        <span className={badge.className}>{badge.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {recent.days > 0 && (
            <section className={s.railCard} aria-labelledby="reports-rail-recent">
              <h2 id="reports-rail-recent" className={s.railTitle}>{rt("rail.recent")}</h2>
              <dl className={s.railFigures}>
                <div><dt>{rt("rail.fired")}</dt><dd data-tone={recent.fired ? "negative" : undefined} data-figure>{recent.fired}</dd></div>
                <div><dt>{rt("rail.resolved")}</dt><dd data-figure>{recent.resolved}</dd></div>
                <div><dt>{rt("rail.mttr")}</dt><dd className={s.railMttr}>{mttr}</dd></div>
              </dl>
            </section>
          )}

          <nav className={s.railCard} aria-labelledby="reports-rail-links">
            <h2 id="reports-rail-links" className={s.railTitle}>{rt("rail.links")}</h2>
            <ul className={s.railLinks}>
              {operatingLinks.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link href={href} className={s.railLink}>
                    <Icon size={16} strokeWidth={1.75} aria-hidden />
                    <span>{label}</span>
                    <ArrowRight size={14} strokeWidth={1.75} aria-hidden className={s.railLinkGo} />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </div>
  );
}
