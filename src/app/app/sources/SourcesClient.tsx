"use client";

import { Fragment, useState, useEffect, useId, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

import DatabaseLogo, { DATABASES, type DatabaseKey } from "@/components/brand/DatabaseLogo";
import { PageHead } from "@/components/dashboard/PageHead";
import { useMenu } from "@/components/dashboard/useMenu";
import { BaseModal, ConfirmModal, ModalButton } from "@/components/modals";
import { DirectDataSourceForm } from "@/components/data-sources/DirectDataSourceForm";
import { FirestoreDataSourceForm } from "@/components/data-sources/FirestoreDataSourceForm";
import { AttachRepoModal } from "./AttachRepoModal";
import { KpiExtractModal, type ExtractOutcome } from "./KpiExtractModal";
import { KpiReviewModal } from "./KpiReviewModal";
import { classifyKpiStart } from './kpi-start-result';
import { parseKpiRead } from './kpi-read-result';
import type { KpiCategory } from "@/lib/kpi/types";
import { useIntegrations } from "@/components/integrations/IntegrationsContext";
import s from "./data-sources.module.css";

/* ============================================================
   Connections — the management surface for data sources, in the app
   design system.

   Title row (serif title, lede, connect action) → a card GRID, one card per
   source (two columns at the app's content width, one on phones):

     head    engine mark in a quiet tile, the name, a meta line that leads
             with the connection state, a quiet menu
     body    the five-stage pipeline (database · code · understanding ·
             monitoring · alert channel) as label/state rows; a row that
             leads somewhere carries a chevron
     foot    the ONE next step — a primary button for a setup action, an
             outlined one for navigation, a live caption while work runs

   A dashed "connect" tile is pinned as the grid's first cell. The sample source sits a step
   down in its own section; no real source → an empty state centered in the
   shell with one action.
   ============================================================ */

export interface RepoOption {
  id: string;
  /** GitHub's own "owner/repo" format — already discloses which connected org this came from. */
  fullName: string;
  /** Branch the analyzer clones (`--single-branch`); shown so the user attaches the right one. */
  defaultBranch: string;
}

export interface SourceView {
  id: string;
  name: string;
  engine: string;
  provider: string;
  status: string;
  /** OAuth-connected (Supabase) sources are managed via disconnect, not deleted here. */
  isOAuth: boolean;
  /** object (table/collection) count from the introspection cache, or null if never synced. */
  tableCount: number | null;
  lastSyncedLabel: string;
  /** data_source_schemas.status: pending|syncing|fresh|stale|failed, or null if never synced. */
  syncStatus: string | null;
  attachedRepoId: string | null;
  attachedRepoFullName: string | null;
  /** data_source_context.status: pending|generating|fresh|stale|failed, or null if none. */
  contextStatus: string | null;
  /** true when the context doc was authored from an attached repo (tier-2), not the schema baseline. */
  contextFromRepo: boolean;
  /** The auto-provisioned read-only sample — grouped under "샘플", never gets the next-step CTA. */
  isDemo: boolean;
  /** Enabled monitors (alerts) whose metric runs against this source. */
  monitorCount: number;
  /** Org-level Slack alert destination (channel label), or null when alerts go to email only. */
  slackChannel: string | null;
  /** latest kpi_extractions.status for this source, or null if never extracted. */
  kpiExtractionStatus: "running" | "completed" | "failed" | null;
  /** created_at of that latest extraction (for the running-TTL fallback). */
  kpiExtractionAt: string | null;
  kpiProposed: number;
  kpiAccepted: number;
  kpiStale: number;
}

/** Live KPI state for a source — seeded from SourceView, then kept fresh by polling. */
export interface KpiState {
  statusUnavailable?: boolean;
  extractionStatus: "running" | "completed" | "failed" | null;
  extractionAt: string | null;
  proposed: number;
  accepted: number;
  stale: number;
}

type KpiChipKind = "none" | "running" | "proposed" | "stale" | "catalog";

/** next-intl translator signature (structural — avoids importing next-intl's generic type). */
type Translate = (key: string, values?: Record<string, string | number>) => string;

// A 'running' extraction older than this is treated as stuck (mirrors the extract route's TTL) so the
// chip doesn't spin forever — it falls through to the count-derived state.
const KPI_RUNNING_TTL_MS = 20 * 60 * 1000;

const EMPTY_KPI: KpiState = { extractionStatus: null, extractionAt: null, proposed: 0, accepted: 0, stale: 0 };

// The extract route's error codes carry a localized message under kpi.error.<code>.
const KPI_EXTRACT_ERROR_CODES = [
  "trigger_required",
  "trigger_failed",
  "engine_not_supported",
  "demo_not_supported",
  "supabase_not_configured",
];

// The delete/attach/context mutation routes' error codes carry a localized message
// under error.<code>.
const SOURCE_ERROR_CODES = [
  "supabase_not_configured",
  "unauthorized",
  "forbidden",
  "invalid_body",
  "repo_forbidden",
  "cross_org_not_allowed",
  "update_failed",
  "use_disconnect_for_oauth_sources",
  "baseline_failed",
  "repo_invalid",
  "installation_not_found",
  "trigger_required",
  "trigger_failed",
  "context_limit",
];

/** The chip's state machine (doc T2): running → 제안 N개 → 오래됨 → 카탈로그 → 추출. */
function resolveKpiChip(k: KpiState, t: Translate): { kind: KpiChipKind; label: string } {
  const running =
    k.extractionStatus === "running" &&
    (!k.extractionAt || Date.now() - new Date(k.extractionAt).getTime() < KPI_RUNNING_TTL_MS);
  if (running) return { kind: "running", label: t("kpi.chip.generating") };
  if (k.proposed > 0) return { kind: "proposed", label: t("kpi.chip.proposed", { count: k.proposed }) };
  if (k.stale > 0) return { kind: "stale", label: t("kpi.chip.stale") };
  if (k.accepted > 0) return { kind: "catalog", label: t("kpi.chip.catalog") };
  return { kind: "none", label: t("kpi.chip.extract") };
}

type Glyph = "supabase" | "postgres" | "mysql" | "firestore" | "generic";

function glyphFor(src: SourceView): Glyph {
  if (src.provider === "supabase") return "supabase";
  if (src.engine === "firestore" || src.provider === "firebase") return "firestore";
  if (src.engine === "postgres") return "postgres";
  if (src.engine === "mysql") return "mysql";
  return "generic";
}

const LOGO_KEY: Record<Exclude<Glyph, "generic">, DatabaseKey> = {
  supabase: "supabase",
  postgres: "postgresql",
  mysql: "mysql",
  firestore: "firestore",
};
const ENGINE_NAME: Record<string, string> = { postgres: "PostgreSQL", mysql: "MySQL", firestore: "Firestore" };
const PROVIDER_NAME: Record<string, string> = { supabase: "Supabase", firebase: "Firebase" };
const brandColor = (key: DatabaseKey) => DATABASES.find((d) => d.key === key)?.color;

// data_sources.status enum → dot class (from dashboard.css). Label is localized via status.<enum>.
const STATUS_DOT: Record<string, string> = {
  active: "dx-dot-ok",
  pending: "dx-dot-sync",
  error: "dx-dot-attention",
  disabled: "dx-dot-idle",
};
function statusOf(status: string, t: Translate) {
  return {
    dot: STATUS_DOT[status] ?? "dx-dot-idle",
    label: STATUS_DOT[status] ? t(`status.${status}`) : status,
  };
}

const CTX_STATUS_NAMES = ["pending", "generating", "fresh", "stale", "failed"];
function ctxStatusName(s: string, t: Translate): string {
  return CTX_STATUS_NAMES.includes(s) ? t(`context.statusName.${s}`) : s;
}

/** Engine mark in the quiet icon tile — brand marks for the four supported engines. */
function EngineMark({ kind, size = 20 }: { kind: Glyph; size?: number }) {
  if (kind !== "generic") return <DatabaseLogo name={LOGO_KEY[kind]} size={size} />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  );
}

const Arrow = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Plus = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
    <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden>
    <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ChevronRight = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
    <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Chevron = ({ open }: { open?: boolean }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden className={s.chevron} data-open={open || undefined}>
    <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Secondary ("다른 데이터베이스") connect options. Supabase is the primary hero card, rendered
// separately; GitHub is NOT a data-source type — application code is attached from a source card.
// name = proper noun (kept as-is); the human description is localized via connect.type.<type>.
const OTHER_SOURCE_TYPES: { type: "postgres" | "mysql" | "firestore"; name: string }[] = [
  { type: "postgres", name: "PostgreSQL" },
  { type: "mysql", name: "MySQL" },
  { type: "firestore", name: "Firestore" },
];

/**
 * Pipeline state tone → the small mono tag it renders as. `id` is an identifier (a repo, a
 * channel): mono, never uppercase, no tag chrome. Semantic colors stay operational (warn/error),
 * indigo marks work in flight, bloom marks AI proposals awaiting review.
 */
type Tone = "ok" | "idle" | "sync" | "warn" | "error" | "bloom" | "id";

/**
 * A pipeline state as a mono tag. Compound states ("Connected · 48 tables") put the state in the
 * tag and the detail beside it as a quiet caption, so narrow cells wrap between the two instead
 * of inside the tag. The " · " stays in the text (visually hidden) — names read verbatim.
 */
function StateTag({ tone, text }: { tone: Tone; text: string }) {
  const [state, ...detail] = text.split(" · ");
  return (
    <span className={s.state}>
      <span className={s.tag} data-tone={tone}>
        <span className={s.tagDot} aria-hidden />
        {state}
      </span>
      {detail.length > 0 && (
        <span className={s.detail}>
          <span className={s.sep}> · </span>
          {detail.join(" · ")}
        </span>
      )}
    </span>
  );
}

/** An identifier (owner/repo, #channel) that may wrap after a "/" rather than mid-word. */
function Identifier({ value }: { value: string }) {
  const parts = value.split("/");
  return (
    <span className={s.cellId}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          <span className={s.idPart}>{i < parts.length - 1 ? `${part}/` : part}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** One row of the source's pipeline (DB · code · understanding · monitoring · channel). */
function PipeRow({
  label,
  value,
  tone,
  onClick,
  href,
}: {
  label: string;
  value: string;
  tone: Tone;
  onClick?: () => void;
  href?: string;
}) {
  const body = (
    <>
      <span className={s.rowKey}>{label}</span>
      <span className={s.rowValue}>{tone === "id" ? <Identifier value={value} /> : <StateTag tone={tone} text={value} />}</span>
      {(href || onClick) && (
        <span className={s.rowGo} aria-hidden>
          <ChevronRight />
        </span>
      )}
    </>
  );
  if (href) {
    return (
      <li>
        <Link href={href} className={s.row} data-interactive>
          {body}
        </Link>
      </li>
    );
  }
  if (onClick) {
    return (
      <li>
        <button type="button" className={s.row} data-interactive onClick={onClick}>
          {body}
        </button>
      </li>
    );
  }
  return (
    <li>
      <div className={s.row}>{body}</div>
    </li>
  );
}

/** The row menu — shared header-menu behaviour (Escape, outside press, arrows, focus return). */
function SourceMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const menu = useMenu<HTMLButtonElement>();
  return (
    <span className={s.menuWrap}>
      <button className={s.menuBtn} type="button" aria-label={label} {...menu.triggerProps}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden>
          <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
          <circle cx="8" cy="8" r="1.25" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
        </svg>
      </button>
      {menu.open && (
        <div className={s.menu} {...menu.menuProps}>
          {children(() => menu.close())}
        </div>
      )}
    </span>
  );
}

/** "← 뒤로" — the connect modal's form panels return to the chooser. */
function BackButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={s.back}>
      {label}
    </button>
  );
}

export function SourcesClient({
  sources,
  repos,
  githubAppUrl,
}: {
  sources: SourceView[];
  repos: RepoOption[];
  /** The GitHub App's public page (server-resolved from GITHUB_APP_SLUG); null when unconfigured. */
  githubAppUrl: string | null;
}) {
  const t = useTranslations("appSources");
  const chrome = useTranslations("appChrome");
  const router = useRouter();
  // Supabase OAuth and the GitHub App exist only where the operator registered them. Without the
  // first, the connect dialog IS the direct-connection list; without the second, attaching code
  // is not offered anywhere on this page.
  const integrations = useIntegrations();
  const directOnly = !integrations.supabaseConnect;
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  type PickType = "postgres" | "mysql" | "firestore";
  const [pickedType, setPickedType] = useState<PickType | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);
  const othersId = useId();
  const [deleteFor, setDeleteFor] = useState<SourceView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  // repo attach modal — selection/save live in AttachRepoModal; this only tracks the target
  const [attachFor, setAttachFor] = useState<SourceView | null>(null);

  // context (SUPALENS.md) modal
  const [ctxFor, setCtxFor] = useState<SourceView | null>(null);
  const [ctxDoc, setCtxDoc] = useState<{ contentMd: string | null; status: string | null } | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [ctxGenerating, setCtxGenerating] = useState(false);
  const [ctxErr, setCtxErr] = useState<string | null>(null);

  // KPI catalog (◆ chip). Seeded from server props, then kept live by polling while an extraction runs.
  const [kpiState, setKpiState] = useState<Record<string, KpiState>>(() =>
    Object.fromEntries(
      sources.map((src) => [
        src.id,
        {
          extractionStatus: src.kpiExtractionStatus,
          extractionAt: src.kpiExtractionAt,
          proposed: src.kpiProposed,
          accepted: src.kpiAccepted,
          stale: src.kpiStale,
        } satisfies KpiState,
      ]),
    ),
  );
  const [kpiBusy, setKpiBusy] = useState<string | null>(null);
  const kpiUnconfirmed = useRef(new Set<string>());
  const kpiInFlight = useRef(new Map<string, Promise<ExtractOutcome>>());
  const [kpiNotice, setKpiNotice] = useState<{ kind: "err" | "quota" | "unknown"; text: string } | null>(null);
  // The extraction modal (category picker → progress → done). Null = closed.
  const [kpiModalFor, setKpiModalFor] = useState<SourceView | null>(null);
  // The KPI review modal (the proposed/calculated list). Null = closed.
  const [kpiReviewFor, setKpiReviewFor] = useState<SourceView | null>(null);

  // Re-read one source's KPI chip state (counts + extraction status) — used after the review modal
  // closes so accepted/dismissed changes reflect on the chip without a full page reload.
  async function refreshKpiState(id: string) {
    try {
      const res = await fetch(`/api/data-sources/${id}/kpis`);
      const next = res.ok ? parseKpiRead(await res.json()) : null;
      setKpiState(prev => ({ ...prev, [id]: next ?? { ...(prev[id] ?? EMPTY_KPI), statusUnavailable: true } }));
    } catch {
      setKpiState(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_KPI), statusUnavailable: true } }));
    }
  }

  // While ANY source is mid-extraction, poll GET every 5s (same cadence as the context chip). The
  // signature is stable across polls that don't change the running set, so the interval isn't churned.
  const runningKpiIds = sources
    .filter((src) => src.engine !== "firestore" && resolveKpiChip(kpiState[src.id] ?? EMPTY_KPI, t).kind === "running")
    .map((src) => src.id);
  const runningKpiSignature = runningKpiIds.join(",");
  useEffect(() => {
    if (!runningKpiSignature) return;
    const ids = runningKpiSignature.split(",");
    let cancelled = false;
    const timer = setInterval(() => {
      ids.forEach(async (id) => {
        try {
          const res = await fetch(`/api/data-sources/${id}/kpis`);
          if (cancelled) return;
          const read = res.ok ? parseKpiRead(await res.json()) : null;
          // This poll follows a known run. An absent extraction is not its terminal acknowledgement.
          const next = read?.extractionStatus ? read : null;
          if (cancelled) return;
          setKpiState(prev => ({ ...prev, [id]: next ?? { ...(prev[id] ?? EMPTY_KPI), statusUnavailable: true } }));
          if (next && next.extractionStatus !== 'running') router.refresh();
        } catch {
          if (!cancelled) setKpiState(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_KPI), statusUnavailable: true } }));
        }
      });
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runningKpiSignature, router]);

  // Called by the extraction modal. Sends the selected categories, flips the source to 'running' so
  // the poller + chip update, and returns the outcome so the modal can surface quota/errors inline.
  function startExtract(id: string, categories: KpiCategory[]): Promise<ExtractOutcome> {
    // Closing/reopening a modal must not create a second POST while the first is unresolved.
    const existing = kpiInFlight.current.get(id);
    if (existing) return existing;
    const request = performExtract(id, categories);
    kpiInFlight.current.set(id, request);
    void request.then(() => kpiInFlight.current.delete(id), () => kpiInFlight.current.delete(id));
    return request;
  }

  async function performExtract(id: string, categories: KpiCategory[]): Promise<ExtractOutcome> {
    if (kpiUnconfirmed.current.has(id)) return { ok: false, kind: 'unknown' };
    setKpiBusy(id);
    setKpiNotice(null);
    try {
      const res = await fetch(`/api/data-sources/${id}/kpis/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories }),
      });
      const result = classifyKpiStart(res.status, await res.json().catch(() => null));
      if (result.kind === 'unknown') {
        kpiUnconfirmed.current.add(id);
        setKpiNotice({ kind: 'unknown', text: t('kpi.modal.unconfirmedBody') });
        return { ok: false, kind: 'unknown' };
      }
      if (result.kind === 'quota') {
        const text = t("kpi.quotaDefault");
        setKpiNotice({ kind: "quota", text });
        return { ok: false, kind: "quota", text };
      }
      if (result.kind === 'running') {
        // already running elsewhere → flip to polling
        setKpiState((p) => ({
          ...p,
          [id]: { ...(p[id] ?? EMPTY_KPI), extractionStatus: "running", extractionAt: new Date().toISOString() },
        }));
        return { ok: true };
      }
      if (result.kind === 'rejected') {
        const known = result.code && KPI_EXTRACT_ERROR_CODES.includes(result.code) ? t(`kpi.error.${result.code}`) : undefined;
        const text = known ?? t("kpi.extractFailed", { status: res.status });
        setKpiNotice({ kind: "err", text });
        return { ok: false, kind: "err", text };
      }
      setKpiState((p) => ({
        ...p,
        [id]: { ...(p[id] ?? EMPTY_KPI), extractionStatus: "running", extractionAt: new Date().toISOString() },
      }));
      return { ok: true };
    } catch {
      kpiUnconfirmed.current.add(id);
      const text = t('kpi.modal.unconfirmedBody');
      setKpiNotice({ kind: "unknown", text });
      return { ok: false, kind: "unknown", text };
    } finally {
      setKpiBusy(null);
    }
  }

  function onKpiChip(src: SourceView) {
    const kind = resolveKpiChip(kpiState[src.id] ?? EMPTY_KPI, t).kind;
    // none (never run) or running → the extraction modal (category picker / live progress).
    if (kind === "none" || kind === "running") {
      setKpiModalFor(src);
      return;
    }
    // proposed / stale / catalog → the review MODAL (rows + re-extract live there)
    setKpiReviewFor(src);
  }

  function openConnect() {
    setPickedType(null);
    setOthersOpen(directOnly);
    setConnectOpen(true);
  }
  function closeConnect() {
    setConnectOpen(false);
    setPickedType(null);
    setOthersOpen(false);
  }

  async function doSync(id: string) {
    setSyncing(id);
    try {
      await fetch(`/api/data-sources/${id}/introspect`, { method: "POST" });
    } catch {
      /* best-effort — refresh below reflects whatever status the sync wrote */
    } finally {
      setSyncing(null);
      router.refresh();
    }
  }

  async function doDelete() {
    if (!deleteFor) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      const res = await fetch(`/api/data-sources/${deleteFor.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        const known = d.error && SOURCE_ERROR_CODES.includes(d.error) ? t(`error.${d.error}`) : undefined;
        throw new Error(known ?? d.message ?? t("delete.failed", { status: res.status }));
      }
      setDeleteFor(null);
      router.refresh();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  function openAttach(src: SourceView) {
    if (!integrations.github) return; // no GitHub App on this install → nothing to attach
    setAttachFor(src);
  }
  /** The attach itself succeeded; only the follow-on context regeneration may have been skipped. */
  function onAttached({ contextSkipped }: { contextSkipped: "context_limit" | "quota_exceeded" | null }) {
    setAttachFor(null);
    setConnectNotice({
      kind: "ok",
      text: contextSkipped
        ? t(contextSkipped === "context_limit" ? "attach.contextLimit" : "attach.contextQuota")
        : t("attach.contextQueued"),
    });
    router.refresh();
  }

  async function fetchContext(id: string) {
    const res = await fetch(`/api/data-sources/${id}/context`);
    const d = (await res.json().catch(() => ({}))) as {
      context?: { content_md?: string | null; status?: string | null } | null;
    };
    return { contentMd: d.context?.content_md ?? null, status: d.context?.status ?? null };
  }
  async function openContext(src: SourceView) {
    setCtxErr(null);
    setCtxDoc(null);
    setCtxFor(src);
    setCtxLoading(true);
    try {
      setCtxDoc(await fetchContext(src.id));
    } catch {
      /* ignore — user can retry / generate */
    } finally {
      setCtxLoading(false);
    }
  }
  async function generateContext() {
    if (!ctxFor) return;
    setCtxGenerating(true);
    setCtxErr(null);
    try {
      const res = await fetch(`/api/data-sources/${ctxFor.id}/context`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { tier?: number; message?: string; error?: string };
      if (!res.ok) {
        const known = d.error && SOURCE_ERROR_CODES.includes(d.error) ? t(`error.${d.error}`) : undefined;
        throw new Error(known ?? d.message ?? t("attach.failed", { status: res.status }));
      }
      if (d.tier === 1) {
        // tier-1 baseline is generated synchronously — re-read the fresh doc
        setCtxDoc(await fetchContext(ctxFor.id));
      } else {
        setCtxDoc((p) => ({ contentMd: p?.contentMd ?? null, status: "generating" }));
      }
      router.refresh();
    } catch (e) {
      setCtxErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCtxGenerating(false);
    }
  }

  // While a tier-2 doc is generating, poll the viewer so it fills in when the Trigger run finishes.
  useEffect(() => {
    if (!ctxFor || ctxDoc?.status !== "generating") return;
    const dsId = ctxFor.id;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/data-sources/${dsId}/context`);
        const d = (await res.json().catch(() => ({}))) as {
          context?: { content_md?: string | null; status?: string | null } | null;
        };
        if (cancelled) return;
        const next = { contentMd: d.context?.content_md ?? null, status: d.context?.status ?? null };
        setCtxDoc(next);
        if (next.status !== "generating") {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [ctxFor, ctxDoc?.status, router]);

  // Post-connect feedback: the OAuth callbacks land back here with ?connected=github&repos=N
  // (or ?connected=supabase&projects=N / ?error=<code>). Surface the result inline — without this
  // a successful connect looked like "nothing happened". When the flow started from a source's
  // attach modal (?attach=<sourceId>, round-tripped through the authorize returnTo), reopen that
  // modal so the user finishes attaching. Params are stripped so a reload is silent.
  const [connectNotice, setConnectNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (params.has("supabaseConnection") && !error) return; // shared, server-verified return card owns this flow
    if (!connected && !error) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (error) {
      const known = error === "invalid_state" || error === "installation_claimed";
      setConnectNotice({
        kind: "err",
        text: known ? t(`connect.error.${error}`) : t("connect.error.generic", { code: error }),
      });
      return;
    }
    if (connected === "github") {
      setConnectNotice({ kind: "ok", text: t("connect.connectedGithub", { count: Number(params.get("repos") ?? 0) }) });
      const resume = params.get("attach");
      const src = resume ? sources.find((it) => it.id === resume) : undefined;
      if (src) openAttach(src);
    } else if (connected === "supabase") {
      setConnectNotice({ kind: "ok", text: t("connect.connectedSupabase", { count: Number(params.get("projects") ?? 0) }) });
    }
    // mount-only: the params are a one-shot signal from the OAuth callback redirect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep links (the landing/login "Connect Supabase" CTA, the onboarding modal and the wizard's code
  // step): ?connect=supabase opens the connect modal with the Supabase hero in focus,
  // ?connect=postgres|mysql|firestore opens that database's form; ?attach=<sourceId>
  // opens that source's attach modal. Skipped when this is an OAuth return (handled above).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") || params.get("error")) return;
    const connect = params.get("connect");
    const attach = params.get("attach");
    if (!connect && !attach) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (connect === "supabase") {
      openConnect();
    } else if (connect === "postgres" || connect === "mysql" || connect === "firestore") {
      // the onboarding modal's connect step: open straight on that database's form
      openConnect();
      setPickedType(connect);
    } else if (attach) {
      const src = sources.find((it) => it.id === attach);
      if (src) openAttach(src);
    }
    // mount-only: the params are a one-shot navigation intent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Supabase connect now hands project provisioning to a background task and redirects here with
  // ?connecting=supabase. Poll so sources appear as the task creates them, and stop AS SOON AS a
  // new source actually shows up (not a blind fixed 60s) — 20×3s stays as the give-up ceiling.
  // The URL param is stripped so a manual reload doesn't restart the poll.
  const [connectingSupabase, setConnectingSupabase] = useState(false);
  const provisioningTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const provisioningBaselineRef = useRef(0);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connecting") !== "supabase") return;
    if (params.has("supabaseConnection")) return; // shared card polls metadata and refreshes when ready
    setConnectingSupabase(true);
    provisioningBaselineRef.current = sources.length;
    window.history.replaceState(null, "", window.location.pathname);
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      router.refresh();
      if (attempts >= 20) {
        clearInterval(timer);
        setConnectingSupabase(false);
      }
    }, 3000);
    provisioningTimerRef.current = timer;
    return () => clearInterval(timer);
    // mount-only: the param is a one-shot signal (sources.length is snapshotted as the baseline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);
  useEffect(() => {
    if (!connectingSupabase) return;
    if (sources.length > provisioningBaselineRef.current) {
      if (provisioningTimerRef.current) clearInterval(provisioningTimerRef.current);
      setConnectingSupabase(false);
    }
  }, [sources.length, connectingSupabase]);

  const realSources = sources.filter((src) => !src.isDemo);
  const demoSources = sources.filter((src) => src.isDemo);

  /**
   * The ONE emphasized next step per card, computed from the pipeline (repo → context → KPIs →
   * review → model). The sample source never gets one; an errored OAuth source points at settings.
   */
  /**
   * `setup` = an action that moves the source forward (the card's primary button); `navigate` =
   * a place to go once nothing is pending (an outlined button); `working` = something is running,
   * shown as a live caption rather than a dead disabled button.
   */
  type NextStep = { label: string; kind: "setup" | "navigate" | "working"; onClick?: () => void; href?: string };
  function nextStepFor(src: SourceView): NextStep | null {
    if (src.isDemo) return null;
    if (src.status === "error" || src.status === "disabled") {
      return src.isOAuth ? { label: t("next.manage"), kind: "navigate", href: "/app/settings/integrations" } : null;
    }
    if (!src.attachedRepoId && integrations.github) return { label: t("next.attachRepo"), kind: "setup", onClick: () => openAttach(src) };
    const ctx = src.contextStatus;
    if (ctx === "generating" || ctx === "pending") return { label: t("next.generating"), kind: "working" };
    if (ctx == null || ctx === "failed") return { label: t("next.generateContext"), kind: "setup", onClick: () => openContext(src) };
    if (src.engine !== "firestore") {
      const chip = resolveKpiChip(kpiState[src.id] ?? EMPTY_KPI, t);
      if (chip.kind === "running") return { label: t("next.extracting"), kind: "working" };
      if (chip.kind === "none") return { label: t("next.extractKpis"), kind: "setup", onClick: () => setKpiModalFor(src) };
      if (chip.kind === "proposed" || chip.kind === "stale") return { label: t("next.reviewKpis"), kind: "setup", onClick: () => setKpiReviewFor(src) };
    }
    // The structured Business Model screen replaced the raw-markdown modal as the destination.
    return { label: t("next.viewModel"), kind: "navigate", href: `/app/business-model/${src.id}` };
  }

  const renderCard = (src: SourceView) => {
    const st = statusOf(src.status, t);
    const glyph = glyphFor(src);
    const nameId = `source-${src.id}-name`;
    const Heading = src.isDemo ? "h3" : "h2";
    const engineName = ENGINE_NAME[src.engine] ?? src.engine;
    const providerName = PROVIDER_NAME[src.provider];

    const kpiChip = src.engine !== "firestore" ? resolveKpiChip(kpiState[src.id] ?? EMPTY_KPI, t) : null;
    const kpiSt = kpiState[src.id] ?? EMPTY_KPI;
    // Database cell
    const dbSyncing = syncing === src.id || src.syncStatus === "syncing";
    const db: { value: string; tone: Tone } = dbSyncing
      ? { value: t("pipeline.dbSyncing"), tone: "sync" }
      : src.syncStatus === "failed"
        ? { value: t("pipeline.dbSyncFailed"), tone: "error" }
        : src.tableCount != null
          ? { value: t(src.engine === "firestore" ? "pipeline.dbCollections" : "pipeline.dbTables", { count: src.tableCount }), tone: "ok" }
          : { value: t("pipeline.dbUnsynced"), tone: "idle" };
    // Understanding (SUPALENS.md) cell
    const ctx: { value: string; tone: Tone } =
      src.contextStatus === "fresh"
        ? { value: t(src.contextFromRepo ? "pipeline.ctxFreshCode" : "pipeline.ctxFreshSchema"), tone: "ok" }
        : src.contextStatus === "stale"
          ? { value: t("pipeline.ctxStale"), tone: "warn" }
          : src.contextStatus === "generating" || src.contextStatus === "pending"
            ? { value: t("pipeline.ctxGenerating"), tone: "sync" }
            : src.contextStatus === "failed"
              ? { value: t("pipeline.ctxFailed"), tone: "error" }
              : { value: t("pipeline.ctxNone"), tone: "idle" };
    // Monitoring cell — enabled monitors first; otherwise the KPI catalog state decides.
    const mon: { value: string; tone: Tone; href?: string; onClick?: () => void } =
      src.monitorCount > 0
        ? { value: t("pipeline.monActive", { count: src.monitorCount }), tone: "ok", href: `/app/monitors?source=${src.id}` }
        : kpiChip?.kind === "running"
          ? { value: t("pipeline.monRunning"), tone: "sync", onClick: () => setKpiModalFor(src) }
          : kpiChip?.kind === "proposed"
            ? { value: t("pipeline.monProposed", { count: kpiSt.proposed }), tone: "bloom", onClick: () => setKpiReviewFor(src) }
            : kpiChip
              ? { value: t("pipeline.monNone"), tone: "idle", onClick: () => onKpiChip(src) }
              : { value: t("pipeline.monNone"), tone: "idle", href: "/app/monitors" };
    const slack: { value: string; tone: Tone } = src.slackChannel
      ? { value: src.slackChannel.startsWith("#") ? src.slackChannel : `#${src.slackChannel}`, tone: "id" }
      : { value: t(integrations.email ? "pipeline.slackNone" : "pipeline.alertNone"), tone: "idle" };
    const next = nextStepFor(src);
    const nextBusy = kpiBusy === src.id;

    const nextClass = next?.kind === "setup" ? `dx-btn dx-btn-sm ${s.nextBtn}` : `dx-btn-ghost dx-btn-sm ${s.nextBtn}`;

    return (
      <article key={src.id} className={s.source} data-status={src.status} aria-labelledby={nameId}>
        <header className={s.head}>
          <span className={s.logo} aria-hidden>
            <EngineMark kind={glyph} size={22} />
          </span>

          <div className={s.identity}>
            <div className={s.nameRow}>
              <Heading id={nameId} className={s.name}>{src.name}</Heading>
              {src.isDemo && <span className="dx-badge dx-badge-bloom">{t("sample.badge")}</span>}
            </div>
            <p className={s.meta}>
              {/* A healthy connection is already stated by the Database row; only a problem leads the meta. */}
              {src.status !== "active" && (
                <span className={`${s.metaItem} ${s.metaStatus}`} data-status={src.status}>
                  <span className={`dx-dot ${st.dot}`} aria-hidden />
                  {st.label}
                </span>
              )}
              {providerName && <span className={s.metaItem}>{providerName}</span>}
              <span className={s.metaItem}>{engineName}</span>
              <span className={s.metaItem}>
                {t("meta.lastSynced")} <span className={s.metaValue}>{src.lastSyncedLabel}</span>
              </span>
            </p>
          </div>

          <SourceMenu label={t("card.menuAria", { name: src.name })}>
            {(close) => (
              <>
                <button type="button" role="menuitem" className={s.menuItem} onClick={() => { close(); void doSync(src.id); }}>
                  {t("card.syncSchema")}
                </button>
                {integrations.github && (
                  <button type="button" role="menuitem" className={s.menuItem} onClick={() => { close(); openAttach(src); }}>
                    {src.attachedRepoId ? t("card.changeRepo") : t("card.attachRepo")}
                  </button>
                )}
                {src.isOAuth ? (
                  <Link href="/app/settings/integrations" role="menuitem" className={s.menuItem} onClick={() => close()}>
                    {t("card.manageInSettings")}
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className={s.menuItem}
                    data-danger
                    onClick={() => {
                      close();
                      setDeleteErr(null);
                      setDeleteFor(src);
                    }}
                  >
                    {t("card.delete")}
                  </button>
                )}
              </>
            )}
          </SourceMenu>
        </header>

        <ul className={s.pipe}>
          <PipeRow label={t("pipeline.database")} value={db.value} tone={db.tone} />
          <PipeRow
            label={t("pipeline.application")}
            value={src.attachedRepoFullName ?? t("pipeline.appNone")}
            tone={src.attachedRepoFullName ? "id" : "idle"}
            {...(integrations.github ? { onClick: () => openAttach(src) } : {})}
          />
          <PipeRow
            label={t("pipeline.understanding")}
            value={ctx.value}
            tone={ctx.tone}
            {...(ctx.value === t("pipeline.ctxNone")
              ? { onClick: () => openContext(src) }
              : { href: `/app/business-model/${src.id}` })}
          />
          <PipeRow label={t("pipeline.monitoring")} value={mon.value} tone={mon.tone} href={mon.href} onClick={mon.onClick} />
          <PipeRow label={t("pipeline.slack")} value={slack.value} tone={slack.tone} href="/app/settings/notifications" />
        </ul>

        {next && (
          <div className={s.foot}>
            {next.kind === "working" || nextBusy ? (
              <span className={s.working} role="status">
                <span className="dx-dot dx-dot-sync" aria-hidden />
                {nextBusy ? t("card.kpiStarting") : next.label}
              </span>
            ) : next.href ? (
              <Link href={next.href} className={nextClass}>
                {next.label}
                <Arrow />
              </Link>
            ) : (
              <button type="button" className={nextClass} onClick={next.onClick}>
                {next.label}
                <Arrow />
              </button>
            )}
          </div>
        )}
      </article>
    );
  };

  const connectButton = (
    <button className="dx-btn" type="button" onClick={openConnect}>
      <Plus />
      {t("connect.addTitle")}
    </button>
  );

  return (
    // Connections is a management grid, so it reads at the overview's wide container rather than
    // the 1024px reading column (the shell widens any page that renders data-page-width="wide").
    <div data-page-width="wide" className={s.page}>
      {/* No title-row action: the grid's pinned first tile (or the empty state) is the connect entry. */}
      <PageHead
        title={t("title")}
        subtitle={t("subtitle")}
        /* Business model left the sidebar (it is a property OF a source, not a destination);
           this keeps the roll-up reachable from the page that owns the sources. */
        actions={
          <Link href="/app/business-model" className="dx-btn-ghost dx-btn-sm">
            {chrome("nav.businessModel")}
          </Link>
        }
      />

      {connectNotice && (
        <div role="status" className={`dx-announce ${s.notice}`} data-tone={connectNotice.kind === "err" ? "negative" : undefined}>
          <span className={s.noticeDot} data-tone={connectNotice.kind} aria-hidden />
          <span className={s.noticeText}>{connectNotice.text}</span>
        </div>
      )}
      {connectingSupabase && (
        <div role="status" aria-live="polite" className={`dx-announce ${s.provisioning}`}>
          <div className={s.provisioningBody}>
            <span className="dx-dot dx-dot-sync" aria-hidden />
            <span>{t("connect.provisioning")}</span>
          </div>
          <div className={s.provisioningTrack} aria-hidden />
        </div>
      )}
      {kpiNotice &&
        (kpiNotice.kind === "quota" ? (
          <div className={`dx-announce ${s.notice}`} data-tone="warning">
            <span className={s.noticeDot} data-tone="warn" aria-hidden />
            <span className={s.noticeText}>{kpiNotice.text}</span>
            <Link href="/app/settings/billing" className={`dx-btn-ghost dx-btn-sm ${s.noticeAction}`}>
              {t("kpi.upgradePlan")}
            </Link>
          </div>
        ) : (
          <div role="status" className={`dx-announce ${s.notice}`} data-tone={kpiNotice.kind === "unknown" ? "warning" : "negative"}>
            <span className={s.noticeDot} data-tone={kpiNotice.kind === "unknown" ? "warn" : "err"} aria-hidden />
            <span className={s.noticeText}>{kpiNotice.text}</span>
          </div>
        ))}

      {realSources.length > 0 ? (
        <div className={s.board}>
          {/* Pinned first: connecting another source is always the grid's first cell. */}
          <button type="button" className={s.addCard} onClick={openConnect}>
            <span className={s.addIcon} aria-hidden>
              <Plus />
            </span>
            <span className={s.addTitle}>{t("connect.addTitle")}</span>
            <span className={s.addMarks} aria-hidden>
              {DATABASES.map((db) => (
                <span key={db.key} className={s.addMark}>
                  <DatabaseLogo name={db.key} size={14} />
                </span>
              ))}
            </span>
            <span className={s.srOnly}>{t("connect.addSub")}</span>
          </button>
          {realSources.map(renderCard)}
        </div>
      ) : (
        <section className={s.empty} aria-labelledby="sources-empty-title">
          <ul className={s.emptyMarks} aria-label={t("connect.addSub")}>
            {DATABASES.map((db) => (
              <li key={db.key} className={s.emptyMark} title={db.name}>
                <DatabaseLogo name={db.key} size={16} />
                <span className={s.srOnly}>{db.name}</span>
              </li>
            ))}
          </ul>
          <h2 id="sources-empty-title" className={s.emptyTitle}>{t("empty.title")}</h2>
          <p className={s.emptyBody}>{t(directOnly ? "connect.modalDescriptionDirect" : "connect.modalDescription")}</p>
          <div className={s.emptyActions}>{connectButton}</div>
        </section>
      )}

      {demoSources.length > 0 && (
        <section className={`dx-section ${s.sample}`} aria-labelledby="sources-sample-title">
          <div className="dx-section-head">
            <div>
              <h2 id="sources-sample-title" className="dx-section-title">{t("sample.heading")}</h2>
              <p className="dx-section-sub">{t("sample.note")}</p>
            </div>
          </div>
          <div className={s.board}>{demoSources.map(renderCard)}</div>
        </section>
      )}

      {/* Connect a new data source */}
      <BaseModal
        open={connectOpen}
        onClose={() => { if (!connectBusy) closeConnect(); }}
        closeDisabled={connectBusy}
        size="lg"
        className="max-w-[600px]"
        title={pickedType ? OTHER_SOURCE_TYPES.find(it => it.type === pickedType)?.name : t("connect.modalTitle")}
        description={t(directOnly ? "connect.modalDescriptionDirect" : "connect.modalDescription")}
      >
        {pickedType === null ? (
          <div className={s.chooser}>
            {!directOnly && <div className={s.feature}>
              <div className={s.featureHead}>
                <span className={s.featureLogo} aria-hidden>
                  <DatabaseLogo name="supabase" size={22} />
                </span>
                <span className={s.featureText}>
                  <span className={s.featureTitle}>{t("connect.supabaseHeroTitle")}</span>
                  <span className={s.featureSub}>{t("connect.supabaseHeroSub")}</span>
                </span>
                <span className={`dx-badge dx-badge-bloom ${s.featureTag}`}>{t("connect.recommended")}</span>
              </div>
              <ul className={s.trust}>
                <li><Check />{t("connect.trustRole")}</li>
                <li><Check />{t("connect.trustNoWrite")}</li>
                <li><Check />{t("connect.trustRevoke")}</li>
              </ul>
              <Link href="/api/connect-supabase/authorize?returnTo=/app/sources" className={`dx-btn ${s.featureCta}`}>
                {t("connect.supabaseCta")}
              </Link>
            </div>}

            <div className={s.others}>
              {!directOnly && <button type="button" className={s.othersToggle} aria-expanded={othersOpen} aria-controls={othersId} onClick={() => setOthersOpen((v) => !v)}>
                <Chevron open={othersOpen} />
                <span className={s.othersLabel}>{t("connect.othersToggle")}</span>
                <span className={s.othersHint}>{t("connect.othersHint")}</span>
              </button>}
              {(othersOpen || directOnly) && (
                <div id={othersId} className={s.engines}>
                  {OTHER_SOURCE_TYPES.map((it) => {
                    const key = LOGO_KEY[it.type];
                    return (
                      <button
                        key={it.type}
                        type="button"
                        onClick={() => setPickedType(it.type)}
                        className={s.engine}
                        style={{ ["--engine" as string]: brandColor(key) }}
                      >
                        <span className={s.engineLogo} aria-hidden>
                          <DatabaseLogo name={key} size={18} />
                        </span>
                        <span className={s.engineText}>
                          <span className={s.engineName}>{it.name}</span>
                          <span className={s.engineDesc}>{t(`connect.type.${it.type}`)}</span>
                        </span>
                        <span className={s.engineAction} aria-hidden>
                          {t("connect.cta")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {integrations.github && <p className={s.githubHint}>{t("connect.githubHint")}</p>}
          </div>
        ) : (
          <div className={s.formStep}>
            <div className={s.formTop}>
              <BackButton label={t("connect.back")} onClick={() => setPickedType(null)} disabled={connectBusy} />
              <span className={s.formEngine}>
                <span className={s.formEngineLogo} aria-hidden>
                  <DatabaseLogo name={LOGO_KEY[pickedType]} size={16} />
                </span>
                {t(`connect.type.${pickedType}`)}
              </span>
            </div>
            {(pickedType === "postgres" || pickedType === "mysql") && (
              <DirectDataSourceForm key={pickedType} engine={pickedType} onDone={closeConnect} onBusyChange={setConnectBusy} />
            )}
            {pickedType === "firestore" && (
              <FirestoreDataSourceForm onDone={closeConnect} onBusyChange={setConnectBusy} />
            )}
          </div>
        )}
      </BaseModal>

      {/* Attach / detach a repo — connect-GitHub and repo-pick are one step (AttachRepoModal). */}
      <AttachRepoModal
        source={attachFor}
        repos={repos.map((r) => ({ id: r.id, fullName: r.fullName, defaultBranch: r.defaultBranch }))}
        githubAppUrl={githubAppUrl}
        mapError={(code) => (SOURCE_ERROR_CODES.includes(code) ? t(`error.${code}`) : undefined)}
        onClose={() => setAttachFor(null)}
        onSaved={onAttached}
      />

      {/* Context (SUPALENS.md) viewer + generate */}
      <BaseModal
        open={ctxFor != null}
        onClose={() => setCtxFor(null)}
        size="xl"
        className="max-w-[760px]"
        title={t("context.modalTitle", { name: ctxFor?.name ?? "" })}
        description={t("context.modalDescription")}
      >
        <div className={s.context}>
          <div className={s.contextBar}>
            <span className={s.contextMeta}>
              <span className={s.tag} data-tone={ctxDoc?.status === "fresh" ? "ok" : ctxDoc?.status === "stale" ? "warn" : ctxDoc?.status === "failed" ? "error" : ctxDoc?.status === "generating" || ctxDoc?.status === "pending" ? "sync" : "idle"}>
                <span className={s.tagDot} aria-hidden />
                {t("context.statusPrefix", { status: ctxDoc?.status ? ctxStatusName(ctxDoc.status, t) : t("context.statusNone") })}
              </span>
              <span className={s.contextRepo}>
                {ctxFor?.attachedRepoFullName ? t("context.withRepo", { name: ctxFor.attachedRepoFullName }) : t("context.noRepo")}
              </span>
            </span>
            <ModalButton variant={ctxDoc?.contentMd ? "ghost" : "primary"} onClick={generateContext} disabled={ctxGenerating}>{ctxGenerating ? t("context.requesting") : ctxFor?.attachedRepoFullName ? t("context.regenerateFromRepo") : t("context.generateFromSchema")}</ModalButton>
          </div>
          {ctxErr && <div className={s.contextErr} role="alert">{ctxErr}</div>}
          {ctxLoading ? (
            <p className={s.contextNote}><span className="dx-dot dx-dot-sync" aria-hidden />{t("context.loading")}</p>
          ) : ctxDoc?.contentMd ? (
            <pre className={s.doc}>{ctxDoc.contentMd}</pre>
          ) : ctxDoc?.status === "generating" ? (
            <p className={s.contextNote}><span className="dx-dot dx-dot-sync" aria-hidden />{t("context.generatingBody")}</p>
          ) : (
            <p className={s.contextEmpty}>
              {ctxFor?.attachedRepoFullName
                ? t("context.emptyWithRepo")
                : t("context.emptyNoRepo")}
            </p>
          )}
        </div>
      </BaseModal>

      {/* KPI extraction: category picker → live progress → done */}
      {kpiModalFor && (
        <KpiExtractModal
          key={kpiModalFor.id}
          source={kpiModalFor}
          unconfirmed={kpiUnconfirmed.current.has(kpiModalFor.id)}
          state={kpiState[kpiModalFor.id] ?? EMPTY_KPI}
          onExtract={(categories: KpiCategory[]) => startExtract(kpiModalFor.id, categories)}
          onClose={() => setKpiModalFor(null)}
          onGoReview={() => {
            const src = kpiModalFor;
            setKpiModalFor(null);
            setKpiReviewFor(src);
          }}
        />
      )}

      {/* KPI review: the proposed/calculated list (was a full page at /app/sources/[id]/kpis) */}
      {kpiReviewFor && (
        <KpiReviewModal
          key={kpiReviewFor.id}
          sourceId={kpiReviewFor.id}
          sourceName={kpiReviewFor.name}
          onClose={() => {
            const id = kpiReviewFor.id;
            setKpiReviewFor(null);
            void refreshKpiState(id);
          }}
        />
      )}

      <ConfirmModal
        open={deleteFor != null}
        onClose={() => {
          if (!deleting) setDeleteFor(null);
        }}
        onConfirm={doDelete}
        title={t("delete.title", { name: deleteFor?.name ?? "" })}
        description={
          deleteErr
            ? t("delete.descFailed", { error: deleteErr })
            : t("delete.desc")
        }
        confirmText={t("delete.confirm")}
        confirmVariant="destructive"
        isLoading={deleting}
      />
    </div>
  );
}
