"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import type { ParsedContext, RuleSection } from "@/lib/context/parse";
import { codeRefs, metricKey } from "@/lib/context/parse";
import type { ContextState } from "../data";
import { AlertIcon, InlineCode } from "../Bits";
import s from "../business-model.module.css";
import { isConnectionErrorCode } from "@/lib/supabase-oauth/errors";
import { contextTimestamp, generationOutcome } from "../presentation";

export interface BusinessModelIO {
  request: typeof fetch;
  refresh: () => void;
}

export interface MetricLink {
  status: "proposed" | "accepted" | "dismissed" | "stale";
  title: string;
}

type Tab = "entities" | "rules" | "metrics" | "changes" | "raw";

/** Rule sections in reading order — the order the generator writes them in. */
const RULE_SECTIONS: RuleSection[] = [
  "enums",
  "relationships",
  "filters",
  "conventions",
];

export function BusinessModelTabs({
  sourceId,
  parsed,
  state,
  metricLinks,
  generatedAt,
  generatedFromSha,
  schemaHash,
  model,
  error,
  repoName,
  io,
}: {
  sourceId: string;
  parsed: ParsedContext;
  state: ContextState;
  metricLinks: Record<string, MetricLink>;
  generatedAt: string | null;
  generatedFromSha: string | null;
  schemaHash: string | null;
  model: string | null;
  error: string | null;
  repoName: string | null;
  io?: BusinessModelIO;
}) {
  const t = useTranslations("appBusinessModel");
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [tab, setTab] = useState<Tab>("entities");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [errKind, setErrKind] = useState<
    "generic" | "limit" | "quota" | "running" | null
  >(null);
  const [, startTransition] = useTransition();

  const ruleCount = parsed.rules.length + parsed.gotchas.length;
  const recorded = contextTimestamp(generatedAt, locale);

  async function regenerate() {
    if (busyRef.current || state === "generating") return;
    busyRef.current = true;
    setBusy(true);
    setNote(null);
    setErrKind(null);
    try {
      const res = await (io?.request ?? fetch)(`/api/data-sources/${sourceId}/context`, {
        method: "POST",
      });
      const body: unknown = await res.json().catch(() => null);
      if (!mounted.current) return;
      const outcome = generationOutcome(res.ok, body);
      if (outcome === "completed" || outcome === "started") {
        setNote(t(`changes.${outcome}`));
        // A failed refresh does not undo an acknowledged generation response.
        startTransition(() => { try { (io?.refresh ?? router.refresh)(); } catch { /* retain the confirmed response */ } });
        return;
      }
      setErrKind(outcome);
    } catch {
      if (mounted.current) setErrKind("generic");
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const TABS: Array<{ id: Tab; count?: number }> = [
    { id: "entities", count: parsed.entities.length },
    { id: "rules", count: ruleCount },
    { id: "metrics", count: parsed.metrics.length },
    { id: "changes" },
    { id: "raw" },
  ];

  const statusDot =
    state === "fresh" ? "dx-dot-ok"
      : state === "stale" ? "dx-dot-warning"
        : state === "failed" ? "dx-dot-attention"
          : state === "generating" ? "dx-dot-sync" : "dx-dot-idle";
  const hasFacts = Boolean(generatedAt || repoName || generatedFromSha || schemaHash || model);

  return (
    <div className={s.tabsRoot}>
      <div className={`dx-segmented ${s.tabs}`} role="tablist" aria-label={t("title")}>
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`${id}-tab-${x.id}`}
            aria-controls={`${id}-panel-${x.id}`}
            aria-selected={tab === x.id}
            tabIndex={tab === x.id ? 0 : -1}
            className={tab === x.id ? `${s.tab} ${s.tabOn}` : s.tab}
            onClick={() => setTab(x.id)}
            onKeyDown={(event) => {
              const index = TABS.findIndex(item => item.id === x.id);
              const next = event.key === "ArrowRight" ? (index + 1) % TABS.length
                : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
                  : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              setTab(TABS[next].id);
              document.getElementById(`${id}-tab-${TABS[next].id}`)?.focus();
            }}
          >
            {t(`tabs.${x.id}`)}
            {x.count !== undefined && x.count > 0 && (
              <span className={s.count}>{x.count}</span>
            )}
          </button>
        ))}
      </div>

      {TABS.filter(item => item.id !== tab).map(item => <div key={item.id} id={`${id}-panel-${item.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${item.id}`} hidden />)}
      <div id={`${id}-panel-${tab}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} tabIndex={0} className={s.tabPanel}>
      {tab === "entities" && (
        <div className={s.panel}>
          {parsed.overview && <p className={s.overview}>{parsed.overview}</p>}
          {parsed.entities.length === 0 ? (
            <div className={s.empty}>{t("entities.empty")}</div>
          ) : (
            <div className={s.entityCard}>
              <div className={s.tableWrap} role="region" aria-label={t("tabs.entities")} tabIndex={0}>
                <table className={`dx-table ${s.entities}`}>
                  <thead>
                    <tr>
                      <th scope="col">{t("entities.concept")}</th>
                      <th aria-hidden="true" />
                      <th scope="col">{t("entities.table")}</th>
                      <th scope="col">{t("entities.note")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.entities.map((e, i) => (
                      <tr key={`${e.name}-${e.table}-${i}`}>
                        <td className={s.entityName}>{e.name}</td>
                        <td className={s.arrowCell} aria-hidden="true">
                          →
                        </td>
                        <td className={s.entityTable}>
                          <code className={s.code}>{e.table}</code>
                        </td>
                        <td className={s.entityNote}>{e.description ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "rules" && (
        <div className={s.panel}>
          {ruleCount === 0 ? (
            <div className={s.empty}>{t("rules.empty")}</div>
          ) : (
            <div className={s.doc}>
              {RULE_SECTIONS.map((section) => {
                const rules = parsed.rules.filter((r) => r.section === section);
                if (rules.length === 0) return null;
                return (
                  <section key={section} className={s.docSection}>
                    <div className={s.docAside}>
                      <h2 className={s.docHeading}>
                        {t(`rules.section.${section}`)}
                      </h2>
                      <span className={s.docCount}>{rules.length}</span>
                    </div>
                    <ul className={s.ruleList}>
                      {rules.map((r, i) => {
                        const refs = codeRefs(r.evidence);
                        return (
                          <li key={i} className={s.rule}>
                            <p className={s.ruleText}>
                              <InlineCode text={r.text} />
                            </p>
                            {(refs.length > 0 || r.confidence) && (
                              <div className={s.chips}>
                                {r.confidence === "unconfirmed" && (
                                  <span className={`dx-badge dx-badge-bloom ${s.unconfirmed}`}>
                                    {t("rules.unconfirmed")}
                                  </span>
                                )}
                                {refs.map((ev) => (
                                  <span key={ev} className={s.ref} title={ev}>
                                    {ev}
                                  </span>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}

              {parsed.gotchas.length > 0 && (
                <section className={s.docSection} data-kind="gotchas">
                  <div className={s.docAside}>
                    <h2 className={s.docHeading}>{t("rules.gotchas")}</h2>
                    <span className={s.docCount}>{parsed.gotchas.length}</span>
                  </div>
                  <ul className={s.gotchas}>
                    {parsed.gotchas.map((g, i) => (
                      <li key={i} className={s.gotcha}>
                        <span className={s.gotchaIcon}>
                          <AlertIcon />
                        </span>
                        <p className={s.gotchaText}>
                          <InlineCode text={g} />
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "metrics" && (
        <div className={s.panel}>
          {parsed.metrics.length === 0 ? (
            <div className={s.empty}>{t("metrics.empty")}</div>
          ) : (
            <div className={s.metrics}>
              {parsed.metrics.map((m, i) => {
                const link = metricLinks[metricKey(m.name)];
                const tone = link?.status === "accepted" ? "dx-badge-success"
                  : link?.status === "stale" ? "dx-badge-warning"
                    : link?.status === "proposed" ? "dx-badge-clay" : "";
                return (
                  <article key={`${m.name}-${i}`} className={s.metric}>
                    <div className={s.metricHead}>
                      <div className={s.metricTitleLine}>
                        <h2 className={s.metricName}>{m.name}</h2>
                        {link && (
                          <span className={`dx-badge ${tone}`}>
                            {t(`metrics.status.${link.status}`)}
                          </span>
                        )}
                      </div>
                      <Link
                        href={`/app/sources/${sourceId}/kpis`}
                        className={`dx-text-link ${s.metricLink}`}
                      >
                        {t("metrics.review")} →
                      </Link>
                    </div>
                    {m.definition && (
                      <p className={s.metricDef}>
                        <InlineCode text={m.definition} />
                      </p>
                    )}
                    {m.sql && (
                      <details className={s.disclosure}>
                        <summary>{t("metrics.sql")}</summary>
                        <pre className={s.sql} tabIndex={0} role="region" aria-label={`${m.name} · ${t("metrics.sql")}`}>{m.sql}</pre>
                      </details>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "changes" && (
        <div className={s.panel}>
          <section
            className={`dx-announce ${s.status}`}
            data-state={state}
            data-tone={state === "stale" ? "warning" : state === "failed" ? "negative" : undefined}
          >
            <span className={`dx-dot ${statusDot} ${s.statusDot}`} aria-hidden="true" />
            <div className={s.statusCopy}>
              <h2 className={s.statusTitle}>
                {state === "stale"
                  ? t("changes.staleTitle")
                  : state === "failed"
                    ? t("changes.failedTitle")
                    : state === "generating" ? t("state.generating")
                      : state === "none" ? t("state.none") : t("changes.freshTitle")}
              </h2>
              <p className={s.statusBody}>
                {state === "stale"
                  ? t("changes.staleBody")
                  : state === "failed"
                    ? isConnectionErrorCode(error)
                      ? t("changes.errorReconnect")
                      : (error ?? t("changes.failedTitle"))
                    : state === "generating" ? t("changes.generatingBody")
                      : state === "none" ? t("raw.empty") : t("changes.freshBody")}
              </p>
            </div>
          </section>

          {hasFacts && (
            <dl className={s.facts}>
              {generatedAt && (
                <div className={s.fact}>
                  <dt className={s.factLabel}>{t("changes.generatedAtLabel")}</dt>
                  <dd className={s.factValue}>{recorded ? <time dateTime={recorded.iso}>{recorded.label}</time> : t("changes.timeUnavailable")}</dd>
                </div>
              )}
              {repoName && (
                <div className={s.fact}>
                  <dt className={s.factLabel}>{t("changes.repo")}</dt>
                  <dd className={`${s.factValue} ${s.factMono}`}>{repoName}</dd>
                </div>
              )}
              {generatedFromSha && (
                <div className={s.fact}>
                  <dt className={s.factLabel}>{t("changes.sha")}</dt>
                  <dd className={`${s.factValue} ${s.factMono}`}>{generatedFromSha.slice(0, 12)}</dd>
                </div>
              )}
              {schemaHash && (
                <div className={s.fact}>
                  <dt className={s.factLabel}>{t("changes.schemaHash")}</dt>
                  <dd className={`${s.factValue} ${s.factMono}`}>{schemaHash.slice(0, 16)}</dd>
                </div>
              )}
              {model && (
                <div className={s.fact}>
                  <dt className={s.factLabel}>{t("changes.model")}</dt>
                  <dd className={`${s.factValue} ${s.factMono}`}>{model}</dd>
                </div>
              )}
            </dl>
          )}

          <div className={s.actions}>
            <div className={s.actionButtons}>
              <button
                type="button"
                className="dx-btn"
                onClick={regenerate}
                disabled={busy || state === "generating"}
                aria-busy={busy}
              >
                {busy || state === "generating"
                  ? t("changes.regenerating")
                  : t("changes.regenerate")}
              </button>
              <button type="button" className="dx-btn-ghost" disabled={busy} onClick={() => startTransition(() => { (io?.refresh ?? router.refresh)(); })}>{t("changes.refresh")}</button>
            </div>
            {note && <p className={s.actionNote} role="status">{note}</p>}
            {errKind && (
              <p className={errKind === "running" || errKind === "limit" || errKind === "quota" ? s.actionWarning : s.actionError} role="alert">
                {errKind === "limit"
                  ? t("changes.errorLimit")
                  : errKind === "quota"
                    ? t("changes.errorQuota")
                    : errKind === "running"
                      ? t("changes.errorRunning")
                      : t("changes.errorGeneric")}{" "}
                {(errKind === "limit" || errKind === "quota") && (
                  <Link href="/app/settings/billing">
                    {t("changes.billing")} →
                  </Link>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {tab === "raw" && (
        <div className={s.panel}>
          {parsed.raw.trim() ? (
            <pre className={s.raw} tabIndex={0} role="region" aria-label={t("tabs.raw")}>{parsed.raw}</pre>
          ) : (
            <div className={s.empty}>{t("raw.empty")}</div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
