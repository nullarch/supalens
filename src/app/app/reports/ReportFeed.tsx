"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ArrowRight, Link2, Sparkles } from "lucide-react";

import { BaseModal } from "@/components/modals";
import { expectedRangeLabel, type AlertOp } from "@/lib/alerts/evaluate";
import { durationParts, type AckKind } from "@/lib/alerts/incidents";
import { actionReports, localDay, type Report, type ReportImportance, type ReportTag, type ReportType } from "@/lib/reports/build";
import { setIncidentAck } from "../incidents/actions";
import r from "./reports.module.css";

/* ============================================================
   Report feed — the overview as a report inbox. Supalens files reports the way
   an operations lead reports to the owner; each one is a small document with a
   type, an importance, tags and one next step.

     "Needs you"   open decisions, most important first (the all-reports tab)
     tabs          all · urgent (incl. recoveries) · daily · weekly · analysis
     report log    newest first, grouped by local day
     document      the full memo: filed by / service / time, summary figures,
                   fact vs hypothesis, per-monitor breakdown, acknowledge stamp

   Filters and the open report live in the URL (?type= &tag= &report=) through
   history.replaceState, so a report link is shareable without re-rendering the
   server page on every click.
   ============================================================ */

type Tab = "all" | "urgent" | "daily" | "weekly" | "analysis";
const TABS: Tab[] = ["all", "urgent", "daily", "weekly", "analysis"];
const TAB_TYPES: Record<Exclude<Tab, "all">, ReportType[]> = {
  urgent: ["urgent", "resolved"],
  daily: ["daily"],
  weekly: ["weekly"],
  analysis: ["analysis"],
};
const LEVEL: Record<ReportImportance, number> = { critical: 4, high: 3, normal: 2, low: 1 };
const INTL: Record<string, string> = { ko: "ko-KR", ja: "ja-JP", en: "en-US" };

const tagKey = (tag: ReportTag) => (tag.kind === "service" || tag.kind === "metric" ? `${tag.kind}:${tag.label}` : tag.kind);

export interface ReportFeedProps {
  reports: Report[];
  orgId: string;
  timeZone: string;
  /** Server render time — the same clock the reports were built with. */
  now: number;
  canManage: boolean;
  ackReady: boolean;
}

export function ReportFeed({ reports, orgId, timeZone, now, canManage, ackReady }: ReportFeedProps) {
  const t = useTranslations("appOverview.reports");
  const ti = useTranslations("appIncidents");
  const locale = useLocale();
  const params = useSearchParams();
  const fmt = useFormatters(locale, timeZone, ti);

  const tabParam = params.get("type");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "all";
  const tag = params.get("tag");
  const openId = params.get("report");
  const open = openId ? reports.find((x) => x.id === openId) ?? null : null;

  const setParam = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (value === null) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  // Unread: reports filed after this viewer's last visit to the feed (per org, per browser).
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    const key = `supalens.reports.seen.${orgId}`;
    let last = now - 86_400_000;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && Number.isFinite(Date.parse(stored))) last = Date.parse(stored);
    } catch {
      /* storage blocked — show the last day as new */
    }
    setSeen(last);
    const newest = reports.filter((x) => !x.live).reduce((max, x) => Math.max(max, Date.parse(x.at)), 0);
    try {
      if (newest > last) window.localStorage.setItem(key, new Date(newest).toISOString());
    } catch {
      /* ignore */
    }
  }, [orgId, now, reports]);
  const isNew = (x: Report) => !x.live && seen !== null && Date.parse(x.at) > seen;

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: reports.length, urgent: 0, daily: 0, weekly: 0, analysis: 0 };
    for (const x of reports) for (const k of ["urgent", "daily", "weekly", "analysis"] as const) if (TAB_TYPES[k].includes(x.type)) c[k]++;
    return c;
  }, [reports]);

  const shelf = tab === "all" && !tag ? actionReports(reports) : [];
  const shelfIds = new Set(shelf.map((x) => x.id));
  const filtered = reports.filter(
    (x) => (tab === "all" || TAB_TYPES[tab].includes(x.type)) && (!tag || x.tags.some((g) => tagKey(g) === tag)) && !shelfIds.has(x.id),
  );

  const groups: { key: string; label: string; items: Report[] }[] = [];
  const today = localDay(now, timeZone).key;
  const yesterday = localDay(localDay(now, timeZone).start - 1, timeZone).key;
  for (const x of filtered) {
    const key = localDay(Date.parse(x.at), timeZone).key;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: key === today ? t("feed.today") : key === yesterday ? t("feed.yesterday") : fmt.dateLong(key), items: [] };
      groups.push(group);
    }
    group.items.push(x);
  }

  const tagLabel = (key: string) => {
    if (key === "ai") return t("tag.ai");
    if (key === "action") return t("tag.action");
    return key.slice(key.indexOf(":") + 1);
  };

  const card = (x: Report, shelfItem = false) => (
    <ReportCard
      key={x.id}
      report={x}
      shelf={shelfItem}
      isNew={isNew(x)}
      fmt={fmt}
      onOpen={() => setParam("report", x.id)}
      onTag={(key) => {
        setParam("tag", key);
        setParam("type", null);
      }}
    />
  );

  return (
    <div className={r.feed}>
      {shelf.length > 0 && (
        <section className={r.shelf} aria-labelledby="reports-shelf-title">
          <header className={r.shelfHead}>
            <h2 id="reports-shelf-title" className={r.shelfTitle}>
              {t("feed.needsAction")}
              <span className={r.count}>{shelf.length}</span>
            </h2>
            <p className={r.shelfNote}>{t("feed.needsActionNote")}</p>
          </header>
          <ul className={r.list}>{shelf.map((x) => card(x, true))}</ul>
        </section>
      )}

      <section aria-labelledby="reports-log-title">
        <div className={r.toolbar}>
          <h2 id="reports-log-title" className="dx-section-title">{t("feed.history")}</h2>
          <div className={`dx-segmented ${r.tabs}`} role="group" aria-label={t("feed.filterLabel")}>
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key && !tag}
                onClick={() => {
                  setParam("type", key === "all" ? null : key);
                  setParam("tag", null);
                }}
              >
                {t(`type.${key}`)}
                <span className={r.tabCount}>{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>

        {tag && (
          <div className={r.tagBar}>
            <span className={r.tagActive}>{t("feed.tagFilter", { tag: tagLabel(tag) })}</span>
            <button type="button" className={r.clearTag} onClick={() => setParam("tag", null)}>
              {t("feed.clearTag")}
            </button>
          </div>
        )}

        {groups.length === 0 ? (
          <div className={r.empty}>
            <p>{reports.length === 0 || (tab === "all" && !tag) ? t("feed.empty") : t("feed.emptyFilter")}</p>
            {(tab !== "all" || tag) && (
              <button type="button" className="dx-btn-ghost dx-btn-sm" onClick={() => { setParam("type", null); setParam("tag", null); }}>
                {t("feed.showAll")}
              </button>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className={r.group}>
              <h3 className={r.groupHead}>{group.label}</h3>
              <ul className={r.list}>{group.items.map((x) => card(x))}</ul>
            </div>
          ))
        )}
      </section>

      <ReportDocument
        report={open}
        fmt={fmt}
        canManage={canManage}
        ackReady={ackReady}
        onClose={() => setParam("report", null)}
        onTag={(key) => {
          setParam("report", null);
          setParam("type", null);
          setParam("tag", key);
        }}
      />
    </div>
  );
}

/* ---------------- formatting ---------------- */

export type Formatters = ReturnType<typeof useFormatters>;

export function useFormatters(locale: string, timeZone: string, ti: (key: string, values?: Record<string, string | number>) => string) {
  return useMemo(() => {
    const intl = INTL[locale] ?? "en-US";
    const num = (v: number | null | undefined) =>
      v == null || !Number.isFinite(v)
        ? "—"
        : Number.isInteger(v)
          ? v.toLocaleString(intl)
          : v.toLocaleString(intl, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const duration = (ms: number) => {
      const { unit, n } = durationParts(ms);
      return ti(`duration.${unit}`, { n });
    };
    const fromKey = (key: string) => new Date(`${key}T12:00:00Z`);
    const dayShort = (iso: string) => new Intl.DateTimeFormat(intl, { timeZone, month: "short", day: "numeric" }).format(new Date(iso));
    const dateShort = (key: string) => new Intl.DateTimeFormat(intl, { timeZone: "UTC", month: "short", day: "numeric" }).format(fromKey(key));
    const dateLong = (key: string) => new Intl.DateTimeFormat(intl, { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }).format(fromKey(key));
    const time = (iso: string) => new Intl.DateTimeFormat(intl, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    const dateTime = (iso: string) =>
      new Intl.DateTimeFormat(intl, { timeZone, year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString(intl, { maximumFractionDigits: 1 })}%`;
    return { num, duration, dayShort, dateShort, dateLong, time, dateTime, pct };
  }, [locale, timeZone, ti]);
}

/** The pieces of copy every surface of a report shares. */
export function useReportCopy(fmt: Formatters) {
  const t = useTranslations("appOverview.reports");
  const title = (x: Report) => {
    if (x.kind === "daily") return t("title.daily", { date: fmt.dateLong(String(x.params.date)) });
    if (x.kind === "weekly") return t("title.weekly", { start: fmt.dateShort(String(x.params.start)), end: fmt.dateShort(String(x.params.end)) });
    return t(`title.${x.kind}`, x.params);
  };
  const expected = (x: Report) => {
    const m = x.metric;
    if (!m) return null;
    if (m.alertType === "anomaly") return m.zScore != null && Number.isFinite(m.zScore) ? t("fig.sigma", { z: m.zScore.toFixed(1) }) : null;
    if (m.threshold == null || !m.operator) return null;
    return t("fig.expected", { range: expectedRangeLabel(m.operator as AlertOp, fmt.num(m.threshold)) });
  };
  const summary = (x: Report) => {
    switch (x.kind) {
      case "incident": {
        if (x.findings?.investigating && x.metric?.value == null) return t("summary.investigating");
        return [x.metric ? t("fig.value", { value: fmt.num(x.metric.value) }) : null, expected(x), x.durationMs != null ? t("fig.for", { duration: fmt.duration(x.durationMs) }) : null]
          .filter(Boolean)
          .join(" · ");
      }
      case "resolved":
        return t("summary.resolved", { duration: fmt.duration(x.durationMs ?? 0) });
      case "daily": {
        const tot = x.totals!;
        return tot.fired === 0 && tot.open === 0 ? t("summary.dailyQuiet") : t("summary.daily", { fired: tot.fired, resolved: tot.resolved, open: tot.open });
      }
      case "weekly": {
        const tot = x.totals!;
        const base = t("summary.weekly", { fired: tot.fired, resolved: tot.resolved });
        return tot.mttrMs != null ? `${base} · ${t("summary.mttr", { duration: fmt.duration(tot.mttrMs) })}` : base;
      }
      case "contextReady":
        return t(x.params.basis === "code" ? "summary.contextReadyCode" : "summary.contextReadySchema");
      default:
        return t(`summary.${x.kind}`, x.params);
    }
  };
  const tagText = (tag: ReportTag) => (tag.kind === "ai" ? t("tag.ai") : tag.kind === "action" ? t("tag.action") : tag.label);
  return { title, summary, expected, tagText };
}

/* ---------------- pieces ---------------- */

export function TypeBadge({ type }: { type: ReportType }) {
  const t = useTranslations("appOverview.reports");
  return <span className={r.typeBadge} data-type={type}>{t(`badge.${type}`)}</span>;
}

export function Importance({ level }: { level: ReportImportance }) {
  const t = useTranslations("appOverview.reports");
  const label = t(`importance.${level}`);
  return (
    <span className={r.importance} data-level={level} role="img" aria-label={`${t("importance.label")}: ${label}`}>
      <span className={r.bars} aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} data-on={i <= LEVEL[level] || undefined} />
        ))}
      </span>
      <span aria-hidden>{label}</span>
    </span>
  );
}

function Stamp({ kind, at, fmt }: { kind: AckKind; at: string; fmt: Formatters }) {
  const t = useTranslations("appOverview.reports");
  return (
    <span className={r.stamp} data-kind={kind}>
      <span className={r.stampWord}>{t(`doc.stamp.${kind}`)}</span>
      <span className={r.stampDate}>{fmt.dayShort(at)}</span>
    </span>
  );
}

function ReportCard({
  report: x,
  shelf,
  isNew,
  fmt,
  onOpen,
  onTag,
}: {
  report: Report;
  shelf: boolean;
  isNew: boolean;
  fmt: Formatters;
  onOpen: () => void;
  onTag: (key: string) => void;
}) {
  const t = useTranslations("appOverview.reports");
  const copy = useReportCopy(fmt);
  const titleId = `report-${x.id.replace(/[^a-zA-Z0-9_-]/g, "-")}${shelf ? "-shelf" : ""}`;
  // The badge already says "Daily/Weekly report"; on a card the title only needs the period.
  const cardTitle =
    x.kind === "daily" ? fmt.dateLong(String(x.params.date))
      : x.kind === "weekly" ? `${fmt.dateShort(String(x.params.start))} – ${fmt.dateShort(String(x.params.end))}`
        : copy.title(x);
  // A quiet day or week is still filed, but as one line — it shouldn't bury the reports that matter.
  const quiet = (x.kind === "daily" || x.kind === "weekly") && x.totals?.fired === 0 && x.totals.open === 0;
  if (quiet) {
    return (
      <li>
        <article className={r.card} data-compact data-type={x.type} data-report={x.id} aria-labelledby={titleId}>
          <TypeBadge type={x.type} />
          <h3 id={titleId} className={r.cardTitle}>
            <button type="button" onClick={onOpen}>
              {cardTitle}
            </button>
          </h3>
          <p className={r.cardSummary}>{copy.summary(x)}</p>
          {isNew && <span className={r.newMark}>{t("feed.new")}</span>}
        </article>
      </li>
    );
  }
  return (
    <li>
      <article className={r.card} data-type={x.type} data-report={x.id} data-importance={x.importance} data-action={x.needsAction || undefined} data-shelf={shelf || undefined} aria-labelledby={titleId}>
        <div className={r.cardHead}>
          <TypeBadge type={x.type} />
          <Importance level={x.importance} />
          <span className={r.cardMeta}>
            {x.service && <span>{x.service.name}</span>}
            {/* The day group already dates a daily/weekly report; its title names the period. */}
            {x.live ? <span>{t("feed.live")}</span> : x.kind !== "daily" && x.kind !== "weekly" && <span>{fmt.time(x.at)}</span>}
          </span>
          {isNew && <span className={r.newMark}>{t("feed.new")}</span>}
        </div>
        <h3 id={titleId} className={r.cardTitle}>
          <button type="button" onClick={onOpen}>
            {cardTitle}
          </button>
        </h3>
        <p className={r.cardSummary}>{copy.summary(x)}</p>
        {(x.tags.length > 0 || x.ack) && (
          <div className={r.cardFoot}>
            <ul className={r.tags} aria-label={t("feed.filterLabel")}>
              {x.tags.map((tag) => (
                <li key={tagKey(tag)}>
                  <button type="button" className={r.tag} data-kind={tag.kind} onClick={() => onTag(tagKey(tag))}>
                    {tag.kind === "ai" && <Sparkles size={11} strokeWidth={2} aria-hidden />}
                    {tag.kind === "service" || tag.kind === "metric" ? `#${tag.label}` : copy.tagText(tag)}
                  </button>
                </li>
              ))}
            </ul>
            {x.ack && <Stamp kind={x.ack.kind} at={x.ack.at} fmt={fmt} />}
          </div>
        )}
      </article>
    </li>
  );
}

/** Where the document's primary action goes, by report. */
function ctaFor(x: Report): { key: string; href: string } | null {
  switch (x.kind) {
    case "incident":
    case "resolved":
      return { key: "incident", href: x.href };
    case "connection":
      return { key: "reconnect", href: x.href };
    case "degraded":
    case "paused":
    case "firstCheck":
      return { key: "monitors", href: x.href };
    case "kpiReady":
      return { key: "review", href: x.href };
    case "kpiFailed":
    case "kpiNeeded":
    case "analyzing":
      return { key: "extract", href: x.href };
    case "contextReady":
      return { key: "model", href: x.href };
    case "daily":
    case "weekly":
      return { key: "incidents", href: x.href };
  }
}

function ReportDocument({
  report: x,
  fmt,
  canManage,
  ackReady,
  onClose,
  onTag,
}: {
  report: Report | null;
  fmt: Formatters;
  canManage: boolean;
  ackReady: boolean;
  onClose: () => void;
  onTag: (key: string) => void;
}) {
  const t = useTranslations("appOverview.reports");
  const copy = useReportCopy(fmt);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setError(null);
    setCopied(false);
  }, [x?.id]);

  if (!x) return <BaseModal open={false} onClose={onClose} title="" />;

  const ack = (kind: AckKind | null) => {
    if (!x.incidentId) return;
    setError(null);
    startTransition(async () => {
      const result = await setIncidentAck(x.incidentId!, kind);
      if (result.ok) router.refresh();
      else setError(result.reason === "error" && result.message ? result.message : t("doc.ackFailed"));
    });
  };

  const copyLink = async () => {
    try {
      const url = new URL(window.location.href);
      url.search = "";
      const scope = new URLSearchParams(window.location.search).get("source");
      if (scope) url.searchParams.set("source", scope);
      url.searchParams.set("report", x.id);
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const cta = ctaFor(x);
  const figures: { label: string; value: string; tone?: "negative" | "positive" }[] = [];
  if (x.kind === "incident" && x.metric) {
    figures.push({ label: t("doc.fig.value"), value: fmt.num(x.metric.value), tone: "negative" });
    const exp = x.metric.alertType === "anomaly" ? null : x.metric.threshold != null && x.metric.operator ? expectedRangeLabel(x.metric.operator as AlertOp, fmt.num(x.metric.threshold)) : null;
    figures.push({ label: exp ? t("doc.fig.expected") : t("doc.anomalyRange"), value: exp ?? (x.metric.zScore != null && Number.isFinite(x.metric.zScore) ? `${x.metric.zScore.toFixed(1)}σ` : "—") });
    if (x.metric.changePct != null) figures.push({ label: t("doc.fig.change"), value: fmt.pct(x.metric.changePct) });
    if (x.durationMs != null) figures.push({ label: t("doc.fig.duration"), value: fmt.duration(x.durationMs) });
  } else if (x.kind === "resolved" && x.metric) {
    figures.push({ label: t("doc.fig.recovered"), value: fmt.num(x.metric.value), tone: "positive" });
    if (x.durationMs != null) figures.push({ label: t("doc.fig.duration"), value: fmt.duration(x.durationMs) });
  } else if (x.totals) {
    figures.push({ label: t("doc.fig.fired"), value: fmt.num(x.totals.fired), tone: x.totals.fired ? "negative" : undefined });
    figures.push({ label: t("doc.fig.resolved"), value: fmt.num(x.totals.resolved) });
    figures.push({ label: t("doc.fig.open"), value: fmt.num(x.totals.open), tone: x.totals.open ? "negative" : undefined });
    if (x.kind === "weekly") figures.push({ label: t("doc.fig.mttr"), value: x.totals.mttrMs != null ? fmt.duration(x.totals.mttrMs) : "—" });
  }

  const period = x.period
    ? x.kind === "daily"
      ? fmt.dateLong(String(x.params.date))
      : `${fmt.dateShort(String(x.params.start))} – ${fmt.dateShort(String(x.params.end))}`
    : null;
  let section = 0;
  const heading = (key: string) => (
    <h3 className={r.docSectionTitle}>
      <span className={r.docIndex}>{String(++section).padStart(2, "0")}</span>
      {t(key)}
    </h3>
  );

  return (
    <BaseModal open onClose={onClose} size="xl" className="max-w-[720px]" title={copy.title(x)}>
      <div className={r.doc} data-type={x.type}>
        <div className={r.docBadges}>
          <TypeBadge type={x.type} />
          <Importance level={x.importance} />
          {x.ack && <Stamp kind={x.ack.kind} at={x.ack.at} fmt={fmt} />}
        </div>

        <dl className={r.memo}>
          <div><dt>{t("doc.reporter")}</dt><dd>{t("doc.reporterName")}</dd></div>
          <div><dt>{t("doc.target")}</dt><dd>{x.service?.name ?? t("doc.targetAll")}</dd></div>
          {period ? (
            <div><dt>{t("doc.period")}</dt><dd>{period}</dd></div>
          ) : (
            <div><dt>{t("doc.filed")}</dt><dd>{x.live ? t("feed.live") : fmt.dateTime(x.at)}</dd></div>
          )}
        </dl>

        <section className={r.docSection}>
          {heading("doc.section.summary")}
          <p className={r.docText}>{copy.summary(x)}</p>
          {figures.length > 0 && (
            <dl className={r.figures}>
              {figures.map((f) => (
                <div key={f.label} className={r.figure}>
                  <dt>{f.label}</dt>
                  <dd data-tone={f.tone} data-figure>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {x.live && <p className={r.docNote}>{x.kind === "daily" ? t("doc.draftNote") : t("doc.liveNote")}</p>}
        </section>

        {(x.kind === "incident" || (x.kind === "resolved" && x.findings)) && (
          <>
            <section className={r.docSection}>
              {heading("doc.section.confirmed")}
              <p className={r.docText}>{x.findings?.confirmed ?? (x.findings?.investigating ? t("summary.investigating") : t("doc.noFindings"))}</p>
            </section>
            {x.findings?.likely && (
              <section className={r.docSection}>
                {heading("doc.section.likely")}
                <p className={r.docText}>{x.findings.likely}</p>
                <p className={r.docNote}>
                  <Sparkles size={12} strokeWidth={2} aria-hidden /> {t("doc.likelyNote")}
                </p>
              </section>
            )}
          </>
        )}

        {x.lines && (
          <section className={r.docSection}>
            {heading("doc.section.breakdown")}
            {x.lines.length === 0 ? (
              <p className={r.docText}>{t("doc.noLines")}</p>
            ) : (
              <div className="dx-table-shell">
                <table className={`dx-table ${r.lines}`}>
                  <thead>
                    <tr>
                      <th scope="col">{t("doc.col.monitor")}</th>
                      <th scope="col" className={r.num}>{t("doc.col.fired")}</th>
                      <th scope="col" className={r.num}>{t("doc.col.resolved")}</th>
                      <th scope="col">{t("doc.col.state")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.lines.map((line) => (
                      <tr key={line.alertId}>
                        <td>
                          {line.name}
                          {line.serviceName && !x.service && <span className={r.lineService}>{line.serviceName}</span>}
                        </td>
                        <td className={r.num}>{line.fired}</td>
                        <td className={r.num}>{line.resolved}</td>
                        <td>
                          <span className={line.open ? "dx-badge dx-badge-error" : "dx-badge dx-badge-success"}>
                            {t(line.open ? "doc.state.open" : "doc.state.closed")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={r.docNote}>{t("doc.basis")}</p>
          </section>
        )}

        {(cta || x.incidentId) && (
          <section className={r.docSection}>
            {heading("doc.section.next")}
            <div className={r.docActions}>
              {cta && (
                <Link href={cta.href} className={x.needsAction ? "dx-btn dx-btn-sm" : "dx-btn-ghost dx-btn-sm"}>
                  {t(`doc.cta.${cta.key}`)}
                  <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
                </Link>
              )}
              {x.kind === "incident" && x.incidentId && ackReady && (
                canManage ? (
                  x.ack ? (
                    <button type="button" className="dx-btn-ghost dx-btn-sm" disabled={pending} onClick={() => ack(null)}>
                      {t("doc.unack")}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="dx-btn-ghost dx-btn-sm" disabled={pending} onClick={() => ack("ack")}>
                        {t("doc.ack")}
                      </button>
                      <button type="button" className="dx-btn-ghost dx-btn-sm" disabled={pending} onClick={() => ack("expected")}>
                        {t("doc.expected")}
                      </button>
                    </>
                  )
                ) : (
                  <span className={r.docNote}>{t("doc.viewerNote")}</span>
                )
              )}
            </div>
            {error && <p className={r.docError} role="alert">{error}</p>}
          </section>
        )}

        <footer className={r.docFoot}>
          <ul className={r.tags}>
            {x.tags.map((tag) => (
              <li key={tagKey(tag)}>
                <button type="button" className={r.tag} data-kind={tag.kind} onClick={() => onTag(tagKey(tag))}>
                  {tag.kind === "ai" && <Sparkles size={11} strokeWidth={2} aria-hidden />}
                  {tag.kind === "service" || tag.kind === "metric" ? `#${tag.label}` : copy.tagText(tag)}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={`dx-btn-ghost dx-btn-sm ${r.copy}`} onClick={copyLink}>
            <Link2 size={14} strokeWidth={1.75} aria-hidden />
            <span aria-live="polite">{copied ? t("doc.copied") : t("doc.copyLink")}</span>
          </button>
        </footer>
      </div>
    </BaseModal>
  );
}
