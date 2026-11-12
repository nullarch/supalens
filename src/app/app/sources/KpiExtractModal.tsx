"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { BaseModal } from "@/components/modals";
import { KPI_TEMPLATES } from "@/lib/kpi/templates";
import type { KpiCategory } from "@/lib/kpi/types";
import type { KpiState, SourceView } from "./SourcesClient";
import s from './kpi-extract.module.css';

/** Outcome of a start-extract call, surfaced inline in the modal (quota / error near the action). */
export interface ExtractOutcome {
  ok: boolean;
  kind?: "quota" | "err" | "unknown";
  text?: string;
}

interface KpiExtractModalProps {
  source: SourceView;
  /** Live KPI state for this source (parent seeds + polls it). Drives the progress → done transition. */
  state: KpiState;
  onExtract: (categories: KpiCategory[]) => Promise<ExtractOutcome>;
  onClose: () => void;
  /** Navigate to the review page (/app/sources/[id]/kpis). */
  onGoReview: () => void;
  unconfirmed?: boolean;
}

type Phase = "select" | "progress" | "done" | "unknown";

/** The 5 template categories, in menu order; `custom` is code-derived so it only applies to a
 * repo-attached (tier-2) source. Descriptions are i18n keys under appSources.kpi.modal.cat.<key>. */
const BASE_CATEGORIES: KpiCategory[] = ["growth", "revenue", "engagement", "ops", "funnel"];

/** How many built-in templates back each category (custom has none — it is derived from code). */
const TEMPLATE_COUNT: Record<string, number> = KPI_TEMPLATES.reduce(
  (acc, t) => ({ ...acc, [t.category]: (acc[t.category] ?? 0) + 1 }),
  {} as Record<string, number>,
);

/** mm:ss for the elapsed timer. */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function KpiExtractModal({ source, state, onExtract, onClose, onGoReview, unconfirmed = false }: KpiExtractModalProps) {
  const t = useTranslations("appSources");
  const tier2 = !!source.attachedRepoId;
  const categories: KpiCategory[] = tier2 ? [...BASE_CATEGORIES, "custom"] : BASE_CATEGORIES;

  const [phase, setPhase] = useState<Phase>(unconfirmed ? 'unknown' : state.extractionStatus === "running" ? "progress" : "select");
  const pending = useRef(false);
  const [selected, setSelected] = useState<Set<KpiCategory>>(() => new Set(categories));
  const [err, setErr] = useState<{ kind: "quota" | "err"; text: string } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(state.extractionStatus === "running" ? Date.now() : null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  // Only an explicit completed/failed status can finish a run; a missing status cannot.
  // Once we've observed 'running', guard
  // the optimistic gap between clicking 추출 and the parent flipping state to running.
  const sawRunning = useRef(state.extractionStatus === "running");

  // Progress → done: the parent's 5s poll updates `state`; when a run we saw running finishes, land on done.
  useEffect(() => {
    if (state.extractionStatus === "running") sawRunning.current = true;
    if (phase === "progress" && sawRunning.current && (state.extractionStatus === "completed" || state.extractionStatus === "failed")) {
      setPhase("done");
    }
  }, [state.extractionStatus, phase]);
  useEffect(() => { if (unconfirmed) setPhase('unknown'); }, [unconfirmed]);

  // Tick the elapsed timer only while the progress panel is visible.
  useEffect(() => {
    if (phase !== "progress") return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  function toggle(cat: KpiCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }
  const allSelected = selected.size === categories.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(categories));
  }

  async function start() {
    if (selected.size === 0 || pending.current || unconfirmed) return;
    pending.current = true;
    const cats = categories.filter((c) => selected.has(c));
    setErr(null);
    // Reset the run-observed guard BEFORE showing progress: on a retry from done/empty the previous
    // run left sawRunning=true, which would otherwise bounce us straight back to 'done' before the
    // parent flips state to 'running' again.
    sawRunning.current = false;
    setStartedAt(Date.now());
    setPhase("progress");
    let outcome: ExtractOutcome;
    try { outcome = await onExtract(cats); }
    catch { outcome = { ok: false, kind: 'unknown' }; }
    finally { pending.current = false; }
    if (!outcome.ok) {
      if (outcome.kind === 'unknown') { setPhase('unknown'); return; }
      // Quota / hard error: fall back to the picker and show it inline, next to the action.
      setErr({ kind: outcome.kind ?? "err", text: outcome.text ?? t("kpi.extractFailed", { status: 0 }) });
      setPhase("select");
      setStartedAt(null);
    }
  }

  const elapsedMs = startedAt ? nowTick - startedAt : 0;
  const failed = state.extractionStatus === "failed";
  const proposed = state.proposed;

  return (
    <BaseModal open onClose={onClose} size="lg" className={`max-w-[640px] ${s.modal}`} title={t("kpi.modal.title")} description={t("kpi.modal.subtitle", { name: source.name })}>
      {phase === 'unknown' && <div className={s.unknown} role="alert">
        <strong className={s.unknownTitle}>{t('kpi.modal.unconfirmedTitle')}</strong><p>{t('kpi.modal.unconfirmedBody')}</p>
        {/* Native navigation deliberately clears the per-source uncertain-request lock and re-reads server state. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="dx-btn" href="/app/sources">{t('kpi.modal.reload')}</a>
      </div>}

      {phase === "select" && (
        <div className={s.stack}>
          <div className={s.row}>
            <span className={s.hint}>{t("kpi.modal.pickHint")}</span>
            <button type="button" onClick={toggleAll} className={s.textBtn}>
              {allSelected ? t("kpi.modal.clearAll") : t("kpi.modal.selectAll")}
            </button>
          </div>

          <div className={s.cats}>
            {categories.map((cat) => {
              const on = selected.has(cat);
              const count = TEMPLATE_COUNT[cat] ?? 0;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggle(cat)}
                  aria-pressed={on}
                  className={s.cat}
                  data-custom={cat === "custom" || undefined}
                >
                  <span className={s.catTop}>
                    <span className={s.catName}>{t(`kpi.modal.cat.${cat}.label`)}</span>
                    <span aria-hidden className={s.check}>
                      {on && (
                        <svg viewBox="0 0 16 16" width="11" height="11" fill="none">
                          <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  </span>
                  <span className={s.catDesc}>{t(`kpi.modal.cat.${cat}.desc`)}</span>
                  <span className={s.catMeta}>
                    {cat === "custom" ? t("kpi.modal.codeDerived") : t("kpi.modal.templateCount", { count })}
                  </span>
                </button>
              );
            })}
          </div>

          {!tier2 && <p className={s.note}>{t("kpi.modal.tier1Note")}</p>}

          {err &&
            (err.kind === "quota" ? (
              <div role="alert" className={s.alert} data-tone="warn">
                <span className={s.alertText}>{err.text}</span>
                <Link href="/app/settings/billing" className={`dx-btn-ghost dx-btn-sm ${s.alertAction}`}>
                  {t("kpi.upgradePlan")}
                </Link>
              </div>
            ) : (
              <div role="alert" className={s.alert} data-tone="err">
                {err.text}
              </div>
            ))}

          <div className={s.actions}>
            <button type="button" className="dx-btn-ghost" onClick={onClose}>
              {t("kpi.modal.cancel")}
            </button>
            <button type="button" className="dx-btn" onClick={start} disabled={selected.size === 0}>
              {t("kpi.modal.startCount", { count: selected.size })}
            </button>
          </div>
        </div>
      )}

      {phase === "progress" && (
        <div className={s.stack}>
          <div className={s.progressHead}>
            <span className={s.progressTitleRow}>
              <span className="dx-dot dx-dot-sync" aria-hidden />
              <strong role="status" className={s.progressTitle}>{t(state.extractionStatus === 'running' && !state.statusUnavailable ? "kpi.modal.runningTitle" : 'kpi.modal.awaitingTitle')}</strong>
            </span>
            <span className={s.elapsed}>{t('kpi.modal.viewElapsed', { time: fmtElapsed(elapsedMs) })}</span>
          </div>

          {state.statusUnavailable && <p className={s.alert} data-tone="warn" role="status">{t('kpi.modal.statusUnavailable')}</p>}
          {/* Catalog total, not the number created by this particular run. */}
          {proposed > 0 && (
            <div className={s.count}>
              {t("kpi.modal.catalogCount", { count: proposed })}
            </div>
          )}

          <div className={s.processBox}>
            <p className={s.explanation}>{t('kpi.modal.processHint')}</p>
            <ol className={s.process}>
              {STEPS.map((stepKey) => (
                  <li key={stepKey} className={s.processItem}>
                    <span aria-hidden className={s.processDot} />
                    <span>{t(`kpi.modal.step.${stepKey}`)}</span>
                  </li>
              ))}
            </ol>
          </div>

          <p className={s.note}>{t("kpi.modal.runningHint")}</p>

          <div className={s.actions}>
            <button type="button" className="dx-btn-ghost" onClick={onClose}>
              {t("kpi.modal.background")}
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className={s.stack}>
          {failed ? (
            proposed > 0 ? (
              // Failed midway but the agent had already registered (and we persisted) some KPIs —
              // don't throw that validated work away; let the user review the partial catalog.
              <>
                <div className={s.result} data-tone="warn">
                  <strong className={s.resultTitle}>{t("kpi.modal.partialTitle", { count: proposed })}</strong>
                  <p className={s.resultBody}>{t("kpi.modal.partialBody")}</p>
                </div>
                <div className={s.actions}>
                  <button type="button" className="dx-btn-ghost" onClick={() => setPhase("select")}>
                    {t("kpi.modal.retry")}
                  </button>
                  <button type="button" className="dx-btn" onClick={onGoReview}>
                    {t("kpi.modal.review")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={s.result} data-tone="err">
                  <strong className={s.resultTitle}>{t("kpi.modal.failedTitle")}</strong>
                  <p className={s.resultBody}>{t("kpi.modal.failedBody")}</p>
                </div>
                <div className={s.actions}>
                  <button type="button" className="dx-btn-ghost" onClick={onClose}>
                    {t("kpi.modal.close")}
                  </button>
                  <button type="button" className="dx-btn" onClick={() => setPhase("select")}>
                    {t("kpi.modal.retry")}
                  </button>
                </div>
              </>
            )
          ) : proposed > 0 ? (
            <>
              <div className={s.result} data-tone="bloom">
                <strong className={s.resultTitle}>{t("kpi.modal.doneTitle", { count: proposed })}</strong>
                <p className={s.resultBody}>{t("kpi.modal.doneBody")}</p>
              </div>
              <div className={s.actions}>
                <button type="button" className="dx-btn-ghost" onClick={onClose}>
                  {t("kpi.modal.close")}
                </button>
                <button type="button" className="dx-btn" onClick={onGoReview}>
                  {t("kpi.modal.review")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={s.result}>
                <strong className={s.resultTitle}>{t("kpi.modal.emptyTitle")}</strong>
                <p className={s.resultBody}>{t("kpi.modal.emptyBody")}</p>
              </div>
              <div className={s.actions}>
                <button type="button" className="dx-btn-ghost" onClick={onClose}>
                  {t("kpi.modal.close")}
                </button>
                <button type="button" className="dx-btn" onClick={() => setPhase("select")}>
                  {t("kpi.modal.retry")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </BaseModal>
  );
}

const STEPS = ["schema", "validate", "catalog"] as const;
