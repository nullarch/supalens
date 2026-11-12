"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PageHead } from "@/components/dashboard/PageHead";
import { BaseModal, ModalButton, TextField } from "@/components/modals";
import { House } from "lucide-react";
import { createDashboard, deleteDashboard, renameDashboard, setHomeDashboard, toggleDashboardPin } from "@/lib/dashboards/actions";
import type { DashboardSummary } from "@/lib/dashboards/types";
import { reportChangeResult, reportCreationResult } from "@/lib/dashboards/save-result";
import { useReportOperation } from "./use-report-operation";
import { ArrowIcon, PencilIcon, StarIcon, TrashIcon } from "./report-icons";
import s from "./overview.module.css";

/**
 * Reports index (/app/dashboards) — the management surface the sidebar tree used to be:
 * every saved board (pinned first), pin / rename / delete per row, and "new report".
 * Boards themselves are unchanged (grid, resize, reorder, widget editor live in [slug]).
 */
export interface ReportListActions {
  create: typeof createDashboard;
  pin: typeof toggleDashboardPin;
  rename: typeof renameDashboard;
  remove: typeof deleteDashboard;
  setHome?: typeof setHomeDashboard;
  refresh: () => void;
  navigate: (href: string) => void;
}

export function ReportsIndex({ dashboards, actions, emptyState = false, homeId = null, canSetHome = false }: {
  dashboards: DashboardSummary[];
  actions?: ReportListActions;
  emptyState?: boolean;
  /** The workspace's home board (shown on the Overview). */
  homeId?: string | null;
  /** owner/admin and the home column exists. */
  canSetHome?: boolean;
}) {
  const t = useTranslations("appDashboards");
  const tc = useTranslations("appChrome");
  const common = useTranslations("appCommon");
  const router = useRouter();
  const io = actions ?? { create: createDashboard, pin: toggleDashboardPin, rename: renameDashboard, remove: deleteDashboard, setHome: setHomeDashboard, refresh: router.refresh, navigate: router.push };
  const [home, setHome] = useState(homeId);
  useEffect(() => setHome(homeId), [homeId]);
  const [rows, setRows] = useState(dashboards);
  const [modal, setModal] = useState<{ kind: 'create' } | { kind: 'rename' | 'delete'; report: DashboardSummary } | null>(null);
  const [name, setName] = useState("");
  const operation = useReportOperation();
  const { pending: busy, paused } = operation;
  const newButton = useRef<HTMLButtonElement>(null);
  const deleted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [reviewHref, setReviewHref] = useState<string | null>(null);
  const review = useRef<HTMLAnchorElement>(null);
  const formId = useId();
  useEffect(() => setRows(dashboards), [dashboards]);
  useEffect(() => { if (paused && reviewHref) review.current?.focus(); }, [paused, reviewHref]);
  const ordered = [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position);
  const showEmpty = emptyState && rows.length === 0;

  function show(next: NonNullable<typeof modal>) {
    deleted.current = false;
    setError(null); setName(next.kind === 'create' ? '' : next.report.name); setModal(next);
  }
  function failure(result: { reason?: string; message?: string }, fallback: string) {
    return result.reason === 'unconfigured' ? tc('errors.unconfigured') : result.message ?? fallback;
  }

  function unknown() {
    operation.pause(); setModal(null); setReviewHref('/app/dashboards');
    setNotice({ error: true, text: t('management.unconfirmed') });
  }

  async function followUp(message: string, destination?: string) {
    setNotice({ error: false, text: message });
    try {
      if (destination) await io.navigate(destination);
      if (operation.current()) await io.refresh();
    } catch {
      if (!operation.current()) return;
      setReviewHref(destination ?? '/app/dashboards');
      setNotice({ error: true, text: `${message} ${t('management.viewUpdateFailed')}` });
    }
  }

  async function togglePin(report: DashboardSummary) {
    if (!operation.begin()) return;
    setNotice(null); setReviewHref(null);
    try {
      const result = reportChangeResult(await io.pin(report.id, !report.pinned));
      if (!operation.current()) return;
      if (result.kind === 'unknown') { unknown(); return; }
      if (result.kind === 'rejected') {
        setNotice({ error: true, text: failure(result, t('management.pinFailed')) }); return;
      }
      setRows(previous => previous.map(row => row.id === report.id ? { ...row, pinned: !report.pinned } : row));
      await followUp(t(report.pinned ? 'management.unpinned' : 'management.pinned'));
    } catch { if (operation.current()) unknown(); }
    finally { operation.finish(); }
  }

  async function makeHome(report: DashboardSummary) {
    if (!io.setHome || !operation.begin()) return;
    setNotice(null); setReviewHref(null);
    try {
      const result = reportChangeResult(await io.setHome(report.id));
      if (!operation.current()) return;
      if (result.kind === 'unknown') { unknown(); return; }
      if (result.kind === 'rejected') { setNotice({ error: true, text: failure(result, t('home.adminOnly')) }); return; }
      setHome(report.id);
      await followUp(t('home.done'));
    } catch { if (operation.current()) unknown(); }
    finally { operation.finish(); }
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!modal || (modal.kind !== 'delete' && !name.trim()) || !operation.begin()) return;
    setError(null); setReviewHref(null);
    const fallback = t(modal.kind === 'create' ? 'management.createFailed' : modal.kind === 'rename' ? 'management.renameFailed' : 'management.removeFailed');
    try {
      if (modal.kind === 'create') {
        const result = reportCreationResult(await io.create(name.trim()));
        if (!operation.current()) return;
        if (result.kind === 'unknown') { unknown(); return; }
        if (result.kind === 'rejected') { setError(failure(result, fallback)); return; }
        setRows(previous => previous.some(row => row.id === result.data.id) ? previous : [...previous, { ...result.data, name: name.trim(), pinned: false, position: previous.length }]);
        setModal(null);
        await followUp(t('management.created'), `/app/dashboards/${result.data.slug}`);
      } else if (modal.kind === 'rename') {
        if (name.trim() === modal.report.name) { setModal(null); return; }
        const result = reportChangeResult(await io.rename(modal.report.id, name.trim()));
        if (!operation.current()) return;
        if (result.kind === 'unknown') { unknown(); return; }
        if (result.kind === 'rejected') { setError(failure(result, fallback)); return; }
        setRows(previous => previous.map(row => row.id === modal.report.id ? { ...row, name: name.trim() } : row));
        setModal(null); await followUp(t('management.renamed'));
      } else {
        const result = reportChangeResult(await io.remove(modal.report.id));
        if (!operation.current()) return;
        if (result.kind === 'unknown') { unknown(); return; }
        if (result.kind === 'rejected') { setError(failure(result, fallback)); return; }
        deleted.current = true;
        setRows(previous => previous.filter(row => row.id !== modal.report.id));
        setModal(null); await followUp(t('management.removed'));
      }
    } catch { if (operation.current()) unknown(); }
    finally { operation.finish(); }
  }

  return (
    // The board list sits at the same wide container as the boards it opens.
    <main className={`${s.reportHeader} ${showEmpty ? s.empty : ''}`} data-page-width="wide">
      {showEmpty ? <>
        <div className="dx-page-head">
          <div><h1 className="dx-title">{t('list.emptyTitle')}</h1></div>
        </div>
        <section className={s.emptyShell}>
          <p className={s.emptyText}>{t('list.emptyText')}</p>
          <div className={s.emptyActions}>
            <Link href="/app/sources" className={`dx-btn ${s.emptyAction}`}>{t('list.emptyPrimary')}</Link>
            <button ref={newButton} type="button" className={`dx-btn-ghost ${s.emptyAction}`} disabled={busy || paused} onClick={() => show({ kind: 'create' })}>{t('index.newReport')}</button>
          </div>
        </section>
      </> : <PageHead title={t("index.title")} subtitle={t("index.subtitle")} actions={
        <button ref={newButton} type="button" className={`dx-btn ${s.newReport}`} disabled={busy || paused} onClick={() => show({ kind: 'create' })}>{t("index.newReport")}</button>
      } />}
      {busy && !modal && <p className={s.reportNotice} role="status">{common('processing')}</p>}
      {notice && <p className={s.reportNotice} data-error={notice.error} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      {reviewHref && <a ref={review} className="dx-btn-ghost" href={reviewHref}>{t('management.reviewLatest')}</a>}
      {!showEmpty && <section className={s.library} aria-label={t('index.title')}>
        <div className={s.listHead} aria-hidden>{t('management.name')}</div>
        <ul className={s.reportList}>
          {ordered.map(d => <li key={d.id} className={s.reportRow} data-pinned={d.pinned}>
            <div className={s.reportMain}>
              <Link href={`/app/dashboards/${d.slug}`} className={s.reportName}>{d.name}</Link>
              {d.id === home && <span className={`dx-badge dx-badge-success ${s.pinnedTag}`} data-home>{t("home.badge")}</span>}
              {d.pinned && <span className={`dx-badge dx-badge-clay ${s.pinnedTag}`}>{t("index.pinned")}</span>}
            </div>
            <span className={s.reportSlug} aria-hidden>/{d.slug}</span>
            <span className={s.reportActions}>
              <button type="button" className={s.reportIconBtn} data-pinned={d.pinned} aria-pressed={d.pinned} disabled={busy || paused}
                aria-label={`${d.pinned ? tc("dashboard.pinRemove") : tc("dashboard.pinAdd")}: ${d.name}`} onClick={() => togglePin(d)}>
                <StarIcon filled={d.pinned} />
              </button>
              {canSetHome && io.setHome && d.id !== home && (
                <button type="button" className={s.reportIconBtn} disabled={busy || paused} aria-label={`${t("home.set")}: ${d.name}`} title={t("home.set")} onClick={() => makeHome(d)}>
                  <House size={16} strokeWidth={1.75} aria-hidden />
                </button>
              )}
              <button type="button" className={s.reportIconBtn} disabled={busy || paused} aria-label={`${t("management.rename")}: ${d.name}`} onClick={() => show({ kind: 'rename', report: d })}><PencilIcon /></button>
              <button type="button" className={s.reportIconBtn} disabled={busy || paused} data-destructive aria-label={`${t("management.delete")}: ${d.name}`} onClick={() => show({ kind: 'delete', report: d })}><TrashIcon /></button>
              <Link href={`/app/dashboards/${d.slug}`} className={s.reportOpen} aria-label={`${t("index.open")}: ${d.name}`}>{t("index.open")} <ArrowIcon /></Link>
            </span>
          </li>)}
        </ul>
        {rows.length === 0 && <p className={s.reportEmpty}>{t('add.noSaved')}</p>}
        <p className={s.reportHint}><span>{t("index.emptyHint")}</span><Link href="/app/sources" className={`dx-text-link ${s.reportHintLink}`}>{t("list.emptyPrimary")} <ArrowIcon /></Link></p>
      </section>}
      {modal && <BaseModal open onClose={() => { if (operation.canClose()) setModal(null); }} closeDisabled={busy}
        onCloseAutoFocus={event => { if (review.current) { event.preventDefault(); review.current.focus(); } else if (deleted.current) { event.preventDefault(); newButton.current?.focus(); } }}
        title={modal.kind === 'create' ? t('index.newReport') : modal.kind === 'rename' ? t('management.rename') : t('management.deleteConfirm', { name: modal.report.name })}
        className={s.reportDialog} size="sm" footer={<>
          <ModalButton variant="ghost" disabled={busy} onClick={() => setModal(null)}>{common('cancel')}</ModalButton>
          {modal.kind === 'delete' ? <ModalButton variant="destructive" disabled={busy} onClick={() => submit()}>{busy ? common('processing') : t('management.delete')}</ModalButton> :
            <ModalButton type="submit" form={formId} disabled={busy || !name.trim()}>{busy ? common('processing') : modal.kind === 'create' ? tc('common.create') : t('management.save')}</ModalButton>}
        </>}>
        {modal.kind !== 'delete' && <form id={formId} onSubmit={submit} aria-busy={busy}>
          <TextField label={t('management.name')} value={name} onChange={event => setName(event.target.value)} required disabled={busy} maxLength={modal.kind === 'create' ? 80 : undefined} />
        </form>}
        {error && <p className={s.reportNotice} data-error role="alert">{error}</p>}
        {busy && <p className={s.reportNotice} role="status">{common('processing')}</p>}
      </BaseModal>}
    </main>
  );
}
