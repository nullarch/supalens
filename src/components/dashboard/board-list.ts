import type { DashboardSummary } from "@/lib/dashboards/types";

/* The dashboards section of the sidebar, as a pure decision: which boards show, in what order,
   and whether a "show more" row is needed. Boards are the product's output (the AI drafts them
   and files reports about them), so the rail lists them all at once — like Mixpanel's boards
   list — and only folds a long tail (premium is unlimited) behind one row. */

/** Boards listed before the rest fold behind "show more". Standard's cap (10) always fits. */
export const SIDEBAR_BOARD_LIMIT = 10;

export interface SidebarBoards {
  /** The rows to render, in list order. */
  shown: DashboardSummary[];
  /** How many boards the "show more" row reveals (0 = no row). */
  hidden: number;
}

/** Same order as the dashboards index: favorites first, then the saved position. */
export function orderBoards(boards: readonly DashboardSummary[]): DashboardSummary[] {
  return [...boards].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position);
}

/**
 * The folded list. The board on screen is never hidden: when it sits in the tail it takes the
 * last visible slot, so the rail always shows where you are.
 */
export function sidebarBoards(
  boards: readonly DashboardSummary[],
  opts: { expanded: boolean; currentSlug: string | null; limit?: number },
): SidebarBoards {
  const ordered = orderBoards(boards);
  const limit = opts.limit ?? SIDEBAR_BOARD_LIMIT;
  if (opts.expanded || ordered.length <= limit) return { shown: ordered, hidden: 0 };
  const head = ordered.slice(0, limit - 1);
  const current = opts.currentSlug ? ordered.findIndex((b) => b.slug === opts.currentSlug) : -1;
  const last = current >= limit - 1 ? ordered[current] : ordered[limit - 1];
  return { shown: [...head, last], hidden: ordered.length - limit };
}

/** `/app/dashboards/<slug>` → slug (the board on screen), else null. */
export function boardSlugFromPath(pathname: string): string | null {
  const match = /^\/app\/dashboards\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}
