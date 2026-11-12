import { isSelfHosted } from "@/config/edition";
import {
  Activity,
  Bell,
  Code,
  CreditCard,
  Database,
  House,
  LayoutGrid,
  MessageSquareText,
  Plug,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

/* Information architecture for the /app shell, laid out as a grouped sidebar:
   one unlabeled home entry, then flat labeled groups.

   The rail is deliberately SHORT — a row costs attention on every page, so a destination earns one
   only if people return to it. Overview is home: the workspace's home dashboard. Under it the
   Dashboards section lists every board with a "+" to add one (rendered in AppSidebar from
   board-list.ts, closed by BOARDS_INDEX_ITEM). Operations holds what the product does while nobody
   watches — the monitors and the incidents they raise (one screen), and the reports it files.
   Workspace is where people go to work: Ask and the Connections behind it. Settings is one row that
   opens its own section. Every entry points at a route that exists — a nav row to a missing page is
   a dead link. */

export type NavItem = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  /** Other prefixes that should mark this entry current (legacy routes). */
  alsoActive?: readonly string[];
  /** Match the href exactly instead of by prefix. */
  exact?: boolean;
};

export type NavGroup = { labelKey: string | null; items: readonly NavItem[] };

export const NAV_GROUPS: readonly NavGroup[] = [
  { labelKey: null, items: [{ href: "/app/overview", labelKey: "nav.overview", icon: House }] },
  {
    labelKey: "nav.operations",
    items: [
      // Monitors and incidents are one object in two states, so they are one row and one screen
      // (`/app/monitors`, incidents behind a view switch); the incident DETAIL route lives under
      // /app/incidents/<id> and marks this row current via alsoActive.
      { href: "/app/monitors", labelKey: "nav.watch", icon: Activity, alsoActive: ["/app/alerts", "/app/incidents"] },
      { href: "/app/reports", labelKey: "nav.reports", icon: ScrollText },
    ],
  },
  {
    labelKey: "nav.workspace",
    items: [
      { href: "/app/ask", labelKey: "nav.ask", icon: MessageSquareText },
      // Business model is a property OF a source, reached from its card on /app/sources — it is
      // not its own destination, so it is not a nav row.
      { href: "/app/sources", labelKey: "nav.connections", icon: Database },
    ],
  },
];

/** Settings is ONE sidebar row; its pages carry their own sub-nav (settings/layout.tsx), so six
 *  rows of configuration never sit above the work the product is for. */
export const SETTINGS_ENTRY: NavItem = { href: "/app/settings", labelKey: "nav.settings", icon: Settings };

/** The sections inside Settings — rendered by the settings sub-nav, not by the sidebar.
 *  A self-hosted install has no billing, so that section is dropped (see `settingsItems`). */
export function settingsItems(): readonly NavItem[] {
  return isSelfHosted() ? SETTINGS_ITEMS.filter((i) => i.href !== "/app/settings/billing") : SETTINGS_ITEMS;
}

const SETTINGS_ITEMS: readonly NavItem[] = [
  { href: "/app/settings", labelKey: "nav.settingsGeneral", icon: Settings, exact: true },
  { href: "/app/settings/notifications", labelKey: "nav.settingsNotifications", icon: Bell },
  { href: "/app/settings/members", labelKey: "nav.settingsTeam", icon: Users },
  { href: "/app/settings/billing", labelKey: "nav.settingsBilling", icon: CreditCard },
  { href: "/app/settings/developer", labelKey: "nav.settingsDeveloper", icon: Code },
  // Integrations stays until Connections absorbs the OAuth/GitHub/Slack connect cards.
  { href: "/app/settings/integrations", labelKey: "nav.settingsIntegrations", icon: Plug },
];

/** The last row of the Dashboards section: the index that renames, pins, deletes and sets home.
 *  Exact, so a board route marks its own row instead. */
export const BOARDS_INDEX_ITEM: NavItem = { href: "/app/dashboards", labelKey: "nav.allDashboards", icon: LayoutGrid, exact: true };

export const SETTINGS_HREF = "/app/settings";

export function isCurrent(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return [item.href, ...(item.alsoActive ?? [])].some((h) => pathname === h || pathname.startsWith(h + "/"));
}
