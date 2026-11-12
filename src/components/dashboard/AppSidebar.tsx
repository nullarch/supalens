"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useId, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, PanelLeft, Plus, X } from "lucide-react";
import LogoMark from "@/components/brand/LogoMark";
import type { AppChrome } from "@/lib/dashboards/types";
import { createOrg } from "@/lib/org/actions";
import { createDashboard } from "@/lib/dashboards/actions";
import { reportCreationResult } from "@/lib/dashboards/save-result";
import { BaseModal } from "@/components/modals";
import { ModalButton, TextField } from "@/components/modals/controls";
import AccountMenu from "./AccountMenu";
import ActiveJobsIndicator from "./ActiveJobsIndicator";
import { BOARDS_INDEX_ITEM, NAV_GROUPS, SETTINGS_ENTRY, isCurrent, type NavGroup, type NavItem } from "./nav";
import { SIDEBAR_BOARD_LIMIT, boardSlugFromPath, sidebarBoards } from "./board-list";
import s from "./Shell.module.css";

/* The /app navigation rail — the app sidebar:
   240px tinted rail (56px icon rail when collapsed), 60px brand row with
   the serif wordmark and a 28px collapse toggle, an unlabeled home item, flat groups
   under 12.5px mono labels, 32px items (lucide 17px icons, 14px/500, current
   #E6E6E4/600), and a single account row at the foot that opens a small menu upward.
   Under the home entry sits the Dashboards section — every board of the org at once with a
   "+" beside its label (Mixpanel's boards list), closed by "All dashboards".
   ≤900px the expanded rail is a Radix dialog drawer. */
export default function AppSidebar({
  chrome,
  open,
  mobile,
  collapsed,
  onToggleCollapsed,
  navigationId,
  menuButtonId,
  onClose,
}: {
  chrome: AppChrome;
  open: boolean;
  mobile: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  navigationId: string;
  menuButtonId: string;
  onClose: () => void;
}) {
  const t = useTranslations("appChrome");
  const common = useTranslations("appCommon");
  const pathname = usePathname();
  const router = useRouter();
  const accountButtonId = useId();
  const compact = collapsed && !mobile;

  // New organization — owned here, outside the rail, so a draft survives the rail
  // remounting when the viewport crosses the drawer breakpoint.
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  // New dashboard — owned here for the same reason (a draft name survives the drawer swap).
  const addBoardButtonId = useId();
  const boardsLabelId = useId();
  const [boardsExpanded, setBoardsExpanded] = useState(false);
  const [boardModalOpen, setBoardModalOpen] = useState(false);
  const [boardName, setBoardName] = useState("");
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardCreated, setBoardCreated] = useState(false);
  // Viewers read boards; creating one is member+ (dashboards_write RLS), so they get no "+".
  const role = chrome.orgs.find((o) => o.id === chrome.org?.id)?.role;
  const canCreateBoard = !!chrome.org && !!role && role !== "viewer";

  async function onCreateBoard() {
    const name = boardName.trim();
    if (!name || creatingBoard) return;
    setCreatingBoard(true);
    setBoardError(null);
    let result: ReturnType<typeof reportCreationResult>;
    try {
      result = reportCreationResult(await createDashboard(name));
    } catch {
      result = { kind: "unknown" };
    }
    setCreatingBoard(false);
    if (result.kind === "rejected") {
      setBoardError(result.reason === "unconfigured" ? t("errors.unconfigured") : result.message ?? t("dashboard.createFailed"));
      return;
    }
    // Confirmed → open the new (empty) board. Unconfirmed → the index, which shows whether it
    // exists, instead of offering a retry that could create a duplicate.
    setBoardCreated(true);
    setBoardModalOpen(false);
    setBoardName("");
    onClose();
    router.push(result.kind === "confirmed" ? `/app/dashboards/${result.data.slug}` : BOARDS_INDEX_ITEM.href);
    router.refresh();
  }

  async function onCreateOrg() {
    const name = orgName.trim();
    if (!name || creatingOrg) return;
    setCreatingOrg(true);
    setOrgError(null);
    const res = await createOrg(name);
    setCreatingOrg(false);
    if (res.ok) {
      setOrgModalOpen(false);
      setOrgName("");
      onClose();
      router.refresh();
    } else {
      setOrgError(res.reason === "unconfigured" ? t("errors.unconfigured") : res.message ?? t("org.createFailed"));
    }
  }

  const orgDialog = (
    <BaseModal
      open={orgModalOpen}
      onClose={() => {
        if (!creatingOrg) setOrgModalOpen(false);
      }}
      title={t("org.createTitle")}
      description={t("org.createDescription")}
      size="sm"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        document.getElementById(accountButtonId)?.focus();
      }}
      footer={
        <>
          <ModalButton type="button" variant="ghost" onClick={() => setOrgModalOpen(false)} disabled={creatingOrg}>
            {t("common.cancel")}
          </ModalButton>
          <ModalButton type="button" onClick={onCreateOrg} disabled={creatingOrg || !orgName.trim()}>
            {creatingOrg ? t("common.creating") : t("common.create")}
          </ModalButton>
        </>
      }
    >
      <TextField
        label={t("org.namePlaceholder")}
        value={orgName}
        onChange={(e) => setOrgName(e.target.value)}
        placeholder={t("org.namePlaceholder")}
        autoFocus
        maxLength={80}
        disabled={creatingOrg}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void onCreateOrg();
          }
        }}
      />
      {orgError && <p className={s.modalError} role="alert">{orgError}</p>}
    </BaseModal>
  );

  const boardDialog = (
    <BaseModal
      open={boardModalOpen}
      onClose={() => {
        if (!creatingBoard) setBoardModalOpen(false);
      }}
      title={t("dashboard.createTitle")}
      description={t("dashboard.createDescription")}
      size="sm"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (!boardCreated) document.getElementById(addBoardButtonId)?.focus();
      }}
      footer={
        <>
          <ModalButton type="button" variant="ghost" onClick={() => setBoardModalOpen(false)} disabled={creatingBoard}>
            {t("common.cancel")}
          </ModalButton>
          <ModalButton type="button" onClick={onCreateBoard} disabled={creatingBoard || !boardName.trim()}>
            {creatingBoard ? t("common.creating") : t("common.create")}
          </ModalButton>
        </>
      }
    >
      <TextField
        label={t("dashboard.namePlaceholder")}
        value={boardName}
        onChange={(e) => setBoardName(e.target.value)}
        placeholder={t("dashboard.namePlaceholder")}
        autoFocus
        maxLength={80}
        disabled={creatingBoard}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void onCreateBoard();
          }
        }}
      />
      {boardError && <p className={s.modalError} role="alert">{boardError}</p>}
    </BaseModal>
  );

  const link = (item: NavItem) => {
    const current = isCurrent(pathname, item);
    const label = t(item.labelKey);
    const Icon = item.icon;
    return (
      <Link key={item.href} href={item.href} title={compact ? label : undefined} className={s.item} aria-current={current ? "page" : undefined} onClick={onClose}>
        <Icon className={s.icon} size={17} strokeWidth={2} aria-hidden />
        <span className={s.itemText}>{label}</span>
      </Link>
    );
  };

  // Settings is one row (its sections live in the settings sub-nav).
  const groups: readonly NavGroup[] = [
    ...NAV_GROUPS,
    { labelKey: null, items: [SETTINGS_ENTRY] },
  ];

  // Dashboards: every board at once (the tail past SIDEBAR_BOARD_LIMIT folds behind one row, never
  // the board on screen), the home board tagged, "+" to add one, "All dashboards" to manage them.
  const currentBoard = boardSlugFromPath(pathname);
  const boards = sidebarBoards(chrome.dashboards, { expanded: boardsExpanded, currentSlug: currentBoard });
  const boardsSection = (
    <div className={s.group} data-boards>
      <div className={s.groupHead}>
        <div className={s.groupLabel} id={boardsLabelId}>{t("nav.dashboards")}</div>
        {canCreateBoard && (
          <button
            type="button"
            id={addBoardButtonId}
            className={s.groupAdd}
            aria-label={t("dashboard.createTitle")}
            title={t("dashboard.createTitle")}
            onClick={() => {
              setBoardError(null);
              setBoardName("");
              setBoardCreated(false);
              setBoardModalOpen(true);
            }}
          >
            <Plus size={15} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
      {boards.shown.length > 0 && (
        <ul className={s.boardList} aria-labelledby={boardsLabelId}>
          {boards.shown.map((board) => (
            <li key={board.id}>
              <Link
                href={`/app/dashboards/${board.slug}`}
                className={s.item}
                data-board
                aria-current={currentBoard === board.slug ? "page" : undefined}
                title={board.name}
                onClick={onClose}
              >
                <span className={s.boardGlyph} aria-hidden />
                <span className={s.itemText}>{board.name}</span>
                {board.id === chrome.homeDashboardId && <span className={s.boardHome}>{t("boards.home")}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {boards.hidden > 0 && (
        <button type="button" className={`${s.item} ${s.boardFold}`} onClick={() => setBoardsExpanded(true)}>
          <ChevronDown className={s.icon} size={17} strokeWidth={2} aria-hidden />
          <span className={s.itemText}>{t("boards.more", { count: boards.hidden })}</span>
        </button>
      )}
      {boardsExpanded && chrome.dashboards.length > SIDEBAR_BOARD_LIMIT && (
        <button type="button" className={`${s.item} ${s.boardFold}`} onClick={() => setBoardsExpanded(false)}>
          <ChevronUp className={s.icon} size={17} strokeWidth={2} aria-hidden />
          <span className={s.itemText}>{t("boards.less")}</span>
        </button>
      )}
      {link(BOARDS_INDEX_ITEM)}
    </div>
  );

  const rail = (
    <aside id={navigationId} className={s.rail} data-mobile={mobile}>
      {mobile && <DialogPrimitive.Title className="sr-only">{t("navigation")}</DialogPrimitive.Title>}
      <div className={s.brandRow}>
        <Link href="/app/overview" className={s.brand} onClick={onClose} aria-label="Supalens">
          <span className={s.mark} aria-hidden><LogoMark size={18} /></span>
          <span className={s.wordmark} aria-hidden>Supalens</span>
        </Link>
        {mobile ? (
          <DialogPrimitive.Close className={s.toggle} aria-label={common("close")}>
            <X size={17} strokeWidth={2} aria-hidden />
          </DialogPrimitive.Close>
        ) : (
          <button type="button" className={s.toggle} onClick={onToggleCollapsed} aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")} aria-expanded={!collapsed} aria-controls={navigationId}>
            <PanelLeft size={17} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>

      <nav className={s.nav} aria-label={t("navigation")}>
        {groups.map((group, index) => (
          <Fragment key={group.labelKey ?? index}>
            <div className={s.group}>
              {group.labelKey && <div className={s.groupLabel}>{t(group.labelKey)}</div>}
              {group.items.map(link)}
            </div>
            {/* the boards follow home */}
            {index === 0 && boardsSection}
          </Fragment>
        ))}
      </nav>

      <div className={s.foot}>
        {!mobile && <ActiveJobsIndicator placement="rail" />}
        <AccountMenu
          user={chrome.user}
          org={chrome.org}
          orgs={chrome.orgs}
          buttonId={accountButtonId}
          onNavigate={onClose}
          onNewOrg={() => {
            setOrgError(null);
            setOrgName("");
            setOrgModalOpen(true);
          }}
        />
      </div>
    </aside>
  );

  // The dialog keeps one tree position on both branches so a draft is not remounted.
  const drawer = (
    <DialogPrimitive.Root open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={s.drawerOverlay} />
        <DialogPrimitive.Content
          asChild
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            // Escape first dismisses the account menu, not its drawer.
            if (event.target instanceof Element && event.target.closest('[role="menu"]')) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (window.matchMedia("(max-width: 900px)").matches) document.getElementById(menuButtonId)?.focus();
          }}
        >
          {rail}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );

  return (
    <>
      {mobile ? drawer : rail}
      {orgDialog}
      {boardDialog}
    </>
  );
}
