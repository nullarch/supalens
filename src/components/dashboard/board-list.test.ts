import { describe, expect, it } from "vitest";

import type { DashboardSummary } from "@/lib/dashboards/types";
import { boardSlugFromPath, orderBoards, sidebarBoards } from "./board-list";

const board = (i: number, pinned = false): DashboardSummary => ({ id: `d${i}`, slug: `b${i}`, name: `Board ${i}`, pinned, position: i });

describe("sidebar boards", () => {
  it("lists favorites first, then by saved position", () => {
    expect(orderBoards([board(2), board(1), board(3, true)]).map((b) => b.id)).toEqual(["d3", "d1", "d2"]);
  });

  it("shows every board up to the limit with no fold", () => {
    const boards = Array.from({ length: 10 }, (_, i) => board(i));
    expect(sidebarBoards(boards, { expanded: false, currentSlug: null })).toEqual({ shown: boards, hidden: 0 });
  });

  it("folds the tail behind one row past the limit", () => {
    const boards = Array.from({ length: 14 }, (_, i) => board(i));
    const result = sidebarBoards(boards, { expanded: false, currentSlug: null });
    expect(result.shown.map((b) => b.id)).toEqual(boards.slice(0, 10).map((b) => b.id));
    expect(result.hidden).toBe(4);
    expect(sidebarBoards(boards, { expanded: true, currentSlug: null })).toEqual({ shown: boards, hidden: 0 });
  });

  it("never folds away the board on screen", () => {
    const boards = Array.from({ length: 14 }, (_, i) => board(i));
    const result = sidebarBoards(boards, { expanded: false, currentSlug: "b12" });
    expect(result.shown).toHaveLength(10);
    expect(result.shown.at(-1)?.slug).toBe("b12");
    expect(result.hidden).toBe(4);
  });

  it("reads the board slug from the route", () => {
    expect(boardSlugFromPath("/app/dashboards/core-kpi")).toBe("core-kpi");
    expect(boardSlugFromPath("/app/dashboards")).toBeNull();
    expect(boardSlugFromPath("/app/overview")).toBeNull();
  });
});
