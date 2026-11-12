"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { deleteDashboard, renameDashboard, toggleDashboardPin } from "@/lib/dashboards/actions";
import type { DashboardSummary } from "@/lib/dashboards/types";
import { BaseModal, ModalButton, TextField } from "@/components/modals";
import { reportChangeResult } from "@/lib/dashboards/save-result";
import { useReportOperation } from "./use-report-operation";
import { PencilIcon, StarIcon, TrashIcon } from "./report-icons";
import s from "./overview.module.css";

/**
 * Board header for /app/dashboards/[slug] — the board's name and its pin / rename / delete
 * affordances. No back link: the sidebar lists every board and "All dashboards" right under home.
 */
export interface ReportHeaderActions {
  pin: typeof toggleDashboardPin;
  rename: typeof renameDashboard;
  remove: typeof deleteDashboard;
  refresh: () => void;
  navigate: (href: string) => void;
}

export function DashboardHeader(props: { dashboard: DashboardSummary; actions?: ReportHeaderActions; children?: ReactNode }) {
  return <ReportHeader key={props.dashboard.id} {...props} />;
}

function ReportHeader({ dashboard, actions, children }: { dashboard: DashboardSummary; actions?: ReportHeaderActions; children?: ReactNode }) {
  const t = useTranslations("appDashboards");
  const tc = useTranslations("appChrome");
  const common = useTranslations("appCommon");
  const router = useRouter();
  const io = actions ?? { pin: toggleDashboardPin, rename: renameDashboard, remove: deleteDashboard, refresh: router.refresh, navigate: router.push };
  const operation = useReportOperation();
  const { pending, paused } = operation;
  const [pinned, setPinned] = useState(dashboard.pinned);
  const [name, setName] = useState(dashboard.name);
  const [draft, setDraft] = useState(dashboard.name);
  const [modal, setModal] = useState<'rename' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [reviewHref, setReviewHref] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const review = useRef<HTMLAnchorElement>(null);
  const formId = useId();
  useEffect(() => setPinned(dashboard.pinned), [dashboard.pinned]);
  useEffect(() => setName(dashboard.name), [dashboard.name]);
  useEffect(() => { if (paused && reviewHref) review.current?.focus(); }, [paused, reviewHref]);

  function unknown() {
    operation.pause(); setModal(null);
    setReviewHref(`/app/dashboards/${dashboard.slug}`);
    setNotice({ error: true, text: t('management.unconfirmed') });
  }

  async function followUp(message: string, destination?: string) {
    setNotice({ error: false, text: message });
    try {
      if (destination) await io.navigate(destination);
      if (operation.current()) await io.refresh();
    } catch {
      if (!operation.current()) return;
      setReviewHref(destination ?? `/app/dashboards/${dashboard.slug}`);
      setNotice({ error: true, text: `${message} ${t('management.viewUpdateFailed')}` });
    }
  }

  async function togglePin() {
    if (!operation.begin()) return;
    const next = !pinned;
    setNotice(null); setReviewHref(null);
    try {
      const result = reportChangeResult(await io.pin(dashboard.id, next));
      if (!operation.current()) return;
      if (result.kind === 'unknown') { unknown(); return; }
      if (result.kind === 'rejected') { setNotice({ error: true, text: result.message ?? t('management.pinFailed') }); return; }
      setPinned(next);
      await followUp(t(next ? 'management.pinned' : 'management.unpinned'));
    } catch { if (operation.current()) unknown(); }
    finally { operation.finish(); }
  }

  async function onRename(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !operation.begin()) return;
    const next = draft.trim();
    if (next === name) { setModal(null); operation.finish(); return; }
    setError(null); setReviewHref(null);
    try {
      const result = reportChangeResult(await io.rename(dashboard.id, next));
      if (!operation.current()) return;
      if (result.kind === 'unknown') { unknown(); return; }
      if (result.kind === 'rejected') { setError(result.message ?? t('management.renameFailed')); return; }
      setName(next); setModal(null);
      await followUp(t('management.renamed'));
    } catch { if (operation.current()) unknown(); }
    finally { operation.finish(); }
  }

  async function onDelete() {
    if (!operation.begin()) return;
    setError(null); setReviewHref(null);
    try {
      const result = reportChangeResult(await io.remove(dashboard.id));
      if (!operation.current()) return;
      if (result.kind === 'unknown') { unknown(); return; }
      if (result.kind === 'rejected') { setError(result.message ?? t('management.deleteFailed')); return; }
      operation.pause(); setRemoved(true); setModal(null); setReviewHref('/app/dashboards');
      await followUp(t('management.removed'), '/app/dashboards');
    } catch { if (operation.current()) unknown(); }
    finally { operation.finish(); }
  }

  return <>
    <div className={s.reportHeader}>
    <div className={`dx-page-head ${s.reportHead}`}>
      <div>
        <h1 className={`dx-title ${s.reportTitle}`}>
          <span>{name}</span>
          <button
            type="button"
            className={s.reportPin}
            data-pinned={pinned}
            aria-pressed={pinned}
            disabled={pending || paused}
            aria-label={pinned ? tc("dashboard.pinRemove") : tc("dashboard.pinAdd")}
            onClick={togglePin}
          >
            <StarIcon filled={pinned} size={18} />
          </button>
        </h1>
      </div>
      <div className="dx-head-actions">
        <button type="button" className={`dx-btn-ghost ${s.quietAction}`} disabled={pending || paused} onClick={() => { setDraft(name); setError(null); setModal('rename'); }}>
          <PencilIcon />
          {t("management.rename")}
        </button>
        <button type="button" className={`dx-btn-ghost ${s.quietAction}`} disabled={pending || paused} data-destructive onClick={() => { setError(null); setModal('delete'); }}>
          <TrashIcon />
          {t("management.delete")}
        </button>
      </div>
    </div>
    {pending && !modal && <p className={s.reportNotice} role="status">{common('processing')}</p>}
    {notice && <p className={s.reportNotice} data-error={notice.error} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    {reviewHref && <a ref={review} className="dx-btn-ghost" href={reviewHref}>{t('management.reviewLatest')}</a>}
    {modal && <BaseModal open title={modal === 'rename' ? t('management.rename') : t('management.deleteConfirm', { name })}
      onClose={() => { if (operation.canClose()) setModal(null); }} closeDisabled={pending}
      onCloseAutoFocus={event => { if (review.current) { event.preventDefault(); review.current.focus(); } }}
      className={s.reportDialog} size="sm" footer={<>
        <ModalButton variant="ghost" disabled={pending} onClick={() => setModal(null)}>{common('cancel')}</ModalButton>
        {modal === 'rename' ? <ModalButton type="submit" form={formId} disabled={pending || !draft.trim()}>{pending ? common('processing') : t('management.save')}</ModalButton> :
          <ModalButton variant="destructive" disabled={pending} onClick={onDelete}>{pending ? common('processing') : t('management.delete')}</ModalButton>}
      </>}>
      {modal === 'rename' && <form id={formId} onSubmit={onRename} aria-busy={pending}>
        <TextField label={t('management.name')} value={draft} onChange={e => setDraft(e.target.value)} disabled={pending} required />
      </form>}
      {error && <p className={s.reportNotice} data-error role="alert">{error}</p>}
      {pending && <p className={s.reportNotice} role="status">{common('processing')}</p>}
    </BaseModal>}
    </div>
    {children && <div inert={pending || paused} hidden={removed}>{children}</div>}
  </>;
}
