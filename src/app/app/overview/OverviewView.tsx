import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Cable,
  Code,
  FileSearch,
  LayoutGrid,
  MessageSquareText,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";

import DatabaseLogo from "@/components/brand/DatabaseLogo";
import { isCloud } from "@/config/edition";
import { integrationAvailability } from "@/lib/integrations/availability";
import { showChecklist } from "@/lib/activation/checklist";
import type { ActivationState } from "@/lib/activation/logic";
import type { DashboardDetail, DashboardSummary } from "@/lib/dashboards/types";
import type { HomeReason } from "@/lib/dashboards/home-pick";
import { DashboardView } from "../dashboards/DashboardView";
import type { OverviewService } from "../reports/workspace";
import { BoardControls } from "./BoardControls";
import { DraftBoardButton } from "./DraftBoardButton";
import { SetupChecklist } from "./SetupChecklist";
import s from "./overview.module.css";

/* ============================================================
   Overview — the workspace's HOME DASHBOARD.

   The product in one line: connect a database, the AI builds the dashboard
   and reports every day. So the home is a board, not a directory:

     title row   which board this is and WHY (chosen, or the automatic rule) ·
                 the "show on Overview" picker (owner/admin) · open to edit
     board       the home dashboard's live widgets (DashboardView)

   Until the workspace is activated, ONE compact checklist sits above the board
   (SetupChecklist) — the app's only onboarding surface. It never covers the page,
   every step carries its own CTA, and /app/setup is the "details" destination.

   Home = the board the workspace chose, else Automatic: the auto-KPI board the
   AI drafts right after KPI extraction (lib/kpi/draft-board.ts), else the first
   favorite, else the first board (lib/dashboards/home-pick.ts). Other boards are
   one click away in the sidebar, so this page never shows a different one.
   Before a board has widgets the page says what is happening instead:
   analyzing → a draft is ready to build → get KPI proposals → empty board.
   An org with no real source renders the onboarding (`new`) view: connect cards,
   the same activation checklist, quick links.
   ============================================================ */

export interface ProposalPreview {
  id: string;
  title: string;
  importance: number;
  dataSourceId: string;
}

export interface OverviewViewProps {
  orgId: string;
  /** Org activation state — what the onboarding checklist renders (null = unknown, no checklist). */
  activation: ActivationState | null;
  /** Real (non-demo) data sources. Empty = the org hasn't connected anything. */
  services: OverviewService[];
  /** Owner/admin/member — viewers read, they don't connect or approve. */
  canManage: boolean;
  /** Owner/admin and the home-dashboard column exists. */
  canSetHome: boolean;
  /** A Supabase account is authorized but no project was chosen yet. */
  connectionPending: boolean;
  /** Every live board of the workspace. */
  boards: DashboardSummary[];
  home: DashboardSummary | null;
  /** Why `home` is home — named in the lede so the choice is never a mystery. */
  homeReason: HomeReason | null;
  /** The board "Automatic" resolves to (named on the picker's Automatic option). */
  autoHome: DashboardSummary | null;
  /** The home board with its live widgets. */
  board: DashboardDetail | null;
  /** The most important KPI proposals, previewed on the draft card. */
  proposals: ProposalPreview[];
}

type Task = {
  key: string;
  icon: React.ReactNode;
  title: string;
  badge?: { label: string; tone?: "bloom" | "sky" | "neutral" };
  body: string;
  cta?: { label: string; href: string; primary?: boolean };
  /** A management action a viewer can't take. */
  manage?: boolean;
  extra?: React.ReactNode;
};

type Strip = { state: string; tone?: "negative" | "warning"; lead: string; notes: string[]; cta?: { label: string; href: string } };

const icon = (Icon: LucideIcon) => <Icon size={22} strokeWidth={1.5} aria-hidden />;

/** Proposals a draft card previews — the draft itself uses the same importance order. */
const PREVIEW_ROWS = 6;

/**
 * The home's presentation, split from the page so the dev gallery can mount every state with
 * fixtures. Pure props in — the only io is the board grid's own actions.
 */
export async function OverviewView(p: OverviewViewProps) {
  const t = await getTranslations("appOverview");
  const h = (key: string, values?: Record<string, string | number>) => t(`home.${key}`, values);
  const integrations = integrationAvailability();

  /* ---------------- shared pieces ---------------- */
  const renderStrip = (strip: Strip) => (
    <div className={`dx-announce ${s.banner}`} data-tone={strip.tone}>
      <div className={s.meta} data-state={strip.state}>
        <span className={s.dot} data-state={strip.state} aria-hidden />
        <span className={s.lead}>{strip.lead}</span>
        {strip.notes.map((note, i) => (
          // A sentence lead ("No data connected yet.") needs no separator; a status lead does.
          <span key={i} className={s.note} data-sep={i > 0 || !/[.。!?]$/.test(strip.lead)}>{note}</span>
        ))}
      </div>
      {strip.cta && <Link href={strip.cta.href} className={`dx-btn-ghost dx-btn-sm ${s.bannerCta}`}>{strip.cta.label}</Link>}
    </div>
  );

  const renderTasks = (tasks: Task[]) => tasks.length > 0 && (
    <div className={s.tasks}>
      {tasks.map((task) => (
        <article key={task.key} className={s.task}>
          <span className={s.taskIcon}>{task.icon}</span>
          <h2 className={s.taskTitle}>
            {task.title}
            {task.badge && <span className={s.badge} data-tone={task.badge.tone}>{task.badge.label}</span>}
          </h2>
          <p className={s.taskBody}>{task.body}</p>
          <div className={s.taskFoot}>
            {task.cta && (!task.manage || p.canManage) ? (
              <Link href={task.cta.href} className={task.cta.primary ? "dx-btn dx-btn-sm" : "dx-btn-ghost dx-btn-sm"}>{task.cta.label}</Link>
            ) : task.manage ? (
              <span className={s.muted}>{h("cards.viewerNote")}</span>
            ) : null}
            {task.extra}
          </div>
        </article>
      ))}
    </div>
  );

  const renderLinks = (links: { href: string; label: string; icon: LucideIcon }[], aside?: React.ReactNode) => (
    <section className="dx-section" aria-labelledby="overview-links-title">
      <div className="dx-section-head">
        <h2 id="overview-links-title" className="dx-section-title">{h("links.title")}</h2>
        {aside}
      </div>
      <div className={s.links}>
        {links.map(({ href, label, icon: Icon }) => (
          <Link key={href + label} href={href} className={s.linkCard}>
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );

  const header = (
    <header className="dx-page-head">
      <div>
        <h1 className="dx-title">{t("title")}</h1>
      </div>
    </header>
  );

  /* The ONE onboarding guide. Server state decides: an activated workspace never gets it, and a
     regression brings it straight back, so every branch below can render it unconditionally. */
  const firstService = p.services[0] ?? null;
  const checklist = p.activation && showChecklist(p.activation) && (
    <SetupChecklist
      orgId={p.orgId}
      activation={p.activation}
      sourceId={firstService?.id ?? null}
      kpiHref={firstService?.kpiHref ?? null}
      canManage={p.canManage}
    />
  );

  /* ================= new: nothing connected ================= */
  if (p.services.length === 0) {
    const strip: Strip = p.connectionPending
      ? { state: "pending_connection", lead: h("banner.pending"), notes: [h("banner.pendingNote")], cta: p.canManage ? { label: h("banner.pendingCta"), href: "/app/setup" } : undefined }
      : { state: "new", lead: h("banner.new"), notes: [h("banner.newNote")] };
    return (
      <div className={s.page} data-view="new" data-page-width="wide">
        {header}
        {renderStrip(strip)}
        {renderTasks([
          // The OAuth round-trip exists only where the operator registered a Supabase OAuth app;
          // otherwise the first step is the direct connection form.
          integrations.supabaseConnect
            ? {
                key: "supabase", icon: <DatabaseLogo name="supabase" size={22} />, title: h("cards.supabase.title"), badge: { label: h("cards.supabase.badge"), tone: "sky" as const }, body: h("cards.supabase.body"),
                cta: p.connectionPending ? { label: h("banner.pendingCta"), href: "/app/setup", primary: true } : { label: h("cards.supabase.cta"), href: "/api/connect-supabase/authorize?returnTo=/app/setup", primary: true },
                manage: true,
                extra: p.canManage ? <Link href="/app/sources" className={s.taskLink}>{h("cards.other.title")} <ArrowRight size={14} strokeWidth={1.75} aria-hidden /></Link> : null,
              }
            : {
                key: "database", icon: icon(Cable), title: h("cards.database.title"), body: h("cards.database.body"),
                cta: { label: h("cards.database.cta"), href: "/app/sources?connect=postgres", primary: true },
                manage: true,
              },
          // The sample card needs the sample database to exist.
          ...(process.env.DEMO_DATABASE_URL
            ? [{ key: "sample", icon: icon(Sparkles), title: h("cards.sample.title"), badge: isCloud() ? { label: h("cards.sample.badge"), tone: "bloom" as const } : undefined, body: h("cards.sample.body"), cta: { label: h("cards.sample.cta"), href: "/app/ask" } }]
            : []),
        ])}
        {/* The live checklist replaces the old static "how it works" strip: one guide, real state. */}
        {checklist && <div className={s.checklistSlot}>{checklist}</div>}
        {renderLinks([
          { href: "/app/ask", label: h("links.ask"), icon: MessageSquareText },
          { href: "/app/sources", label: h("links.connections"), icon: Cable },
          { href: "/app/settings/members", label: h("links.team"), icon: Users },
          { href: "/app/settings/developer", label: h("links.developer"), icon: Code },
        ])}
      </div>
    );
  }

  /* ================= home: the workspace's dashboard ================= */
  const hasWidgets = !!p.board && p.board.widgets.length > 0;
  const lede = p.board
    ? h(`board.reason.${p.homeReason ?? "first"}`, { name: p.board.name })
    : h("board.ledePreparing");

  const controls = p.board && (
    <BoardControls
      boards={p.boards.map((b) => ({ id: b.id, name: b.name }))}
      chosenId={p.homeReason === "chosen" ? p.board.id : null}
      openSlug={p.board.slug}
      canSetHome={p.canSetHome}
      labels={{
        picker: h("board.picker"),
        pickerShort: h("board.pickerShort"),
        auto: p.autoHome ? h("board.auto", { name: p.autoHome.name }) : h("board.autoEmpty"),
        open: h("board.open"),
        saving: h("board.saving"),
        saved: h("board.saved"),
      }}
    />
  );

  /* Before the board has widgets: say what is happening, most actionable first. */
  const drafting = p.services.filter((svc) => svc.pendingCount > 0).sort((a, b) => b.pendingCount - a.pendingCount)[0] ?? null;
  const analyzing = p.services.filter((svc) => svc.stage === "analyzing");
  const extract = p.services.find((svc) => svc.stage === "extract") ?? null;
  const emptyState = hasWidgets ? null : drafting ? "draft" : analyzing.length > 0 ? "analyzing" : extract ? "extract" : "empty";
  const preview = drafting ? p.proposals.filter((k) => k.dataSourceId === drafting.id).slice(0, PREVIEW_ROWS) : [];

  const emptyCard = emptyState && (
    <section className={s.emptyHome} data-state={emptyState} aria-labelledby="home-empty-title">
      <span className={s.taskIcon}>{icon(emptyState === "draft" || emptyState === "analyzing" ? Sparkles : emptyState === "extract" ? FileSearch : LayoutGrid)}</span>
      {emptyState === "draft" && drafting && (
        <>
          <h2 id="home-empty-title" className={s.emptyTitle}>{h("empty.draftTitle")}</h2>
          <p className={s.emptyBody}>{h("empty.draftBody", { service: drafting.name, count: drafting.pendingCount, draft: Math.min(PREVIEW_ROWS, drafting.pendingCount) })}</p>
          {preview.length > 0 && (
            <ol className={s.proposalList}>
              {preview.map((kpi) => (
                <li key={kpi.id} className={s.proposalRow}>
                  <span className={s.proposalName}>{kpi.title}</span>
                  <span className={s.proposalImportance} role="img" aria-label={h("proposals.importanceValue", { value: kpi.importance })}>
                    {Array.from({ length: 5 }, (_, i) => <span key={i} data-on={i < kpi.importance} />)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className={s.emptyNote}>{h("empty.draftNote")}</p>
          <div className={s.emptyActions}>
            {p.canManage ? (
              <DraftBoardButton dataSourceId={drafting.id} label={h("empty.draftCta")} pendingLabel={h("empty.drafting")} />
            ) : (
              <span className={s.muted}>{h("empty.viewerNote")}</span>
            )}
            <Link href={drafting.kpiHref} className="dx-btn-ghost dx-btn-sm">{h("empty.reviewCta")}</Link>
          </div>
        </>
      )}
      {emptyState === "analyzing" && (
        <>
          <h2 id="home-empty-title" className={s.emptyTitle}>{h("empty.analyzingTitle")}</h2>
          <p className={s.emptyBody}>{h("empty.analyzingBody")}</p>
          <ul className={s.analyzingList}>
            {analyzing.map((svc) => (
              <li key={svc.id} className={s.analyzingRow}>
                <span className={s.analyzingLogo} aria-hidden><DatabaseLogo name={svc.engine} size={16} /></span>
                <span>{svc.name}</span>
                <span className={s.dot} data-state="analyzing" aria-hidden />
              </li>
            ))}
          </ul>
        </>
      )}
      {emptyState === "extract" && extract && (
        <>
          <h2 id="home-empty-title" className={s.emptyTitle}>{h("empty.extractTitle")}</h2>
          <p className={s.emptyBody}>{h("empty.extractBody", { service: extract.name })}</p>
          <div className={s.emptyActions}>
            {p.canManage ? (
              <Link href={extract.kpiHref} className="dx-btn dx-btn-sm">{h("empty.extractCta")}</Link>
            ) : (
              <span className={s.muted}>{h("empty.viewerNote")}</span>
            )}
          </div>
        </>
      )}
      {emptyState === "empty" && (
        <>
          <h2 id="home-empty-title" className={s.emptyTitle}>{h("empty.emptyTitle")}</h2>
          <p className={s.emptyBody}>{h("empty.emptyBody")}</p>
          <div className={s.emptyActions}>
            <Link href="/app/ask" className="dx-btn dx-btn-sm">{h("empty.askCta")}</Link>
            <Link href="/app/dashboards" className="dx-btn-ghost dx-btn-sm">{h("empty.boardsCta")}</Link>
          </div>
        </>
      )}
    </section>
  );

  return (
    <div className={s.page} data-view="home" data-state={emptyState ?? "board"} data-page-width="wide">
      <header className="dx-page-head">
        <div>
          <h1 className="dx-title">{t("title")}</h1>
          <p className="dx-sub">{lede}</p>
        </div>
        {controls && <div className={`dx-head-actions ${s.headActions}`}>{controls}</div>}
      </header>
      {checklist}
      {hasWidgets && p.board ? <DashboardView slug={p.board.slug} detail={p.board} /> : emptyCard}
    </div>
  );
}
