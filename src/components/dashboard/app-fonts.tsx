import { DM_Mono, DM_Sans, Noto_Serif_JP, Noto_Serif_KR } from "next/font/google";

/* Product typefaces for /app — the same roles as the editorial home page: DM Sans for interface
   text, DM Mono for labels and identifiers, a regular-weight serif for page and
   section titles. Latin titles use the local Iowan/Georgia stack (no web font);
   the CJK serifs are never preloaded, so only the unicode-range slices a Korean
   or Japanese title uses are fetched. */
const sans = DM_Sans({ subsets: ["latin"], display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap" });
const serifKo = Noto_Serif_KR({ weight: "400", display: "swap", preload: false });
const serifJa = Noto_Serif_JP({ weight: "400", display: "swap", preload: false });

/* The families are published on <html> while an app surface is mounted (see
   dashboard.css), so Radix portals — dialogs, menus — outside the shell use the
   same type as the page behind them. */
const FONT_VARS = `html:has([data-surface="app"]){--ax-font-sans:${sans.style.fontFamily};--ax-font-mono:${mono.style.fontFamily};--ax-font-serif-ko:${serifKo.style.fontFamily};--ax-font-serif-ja:${serifJa.style.fontFamily}}`;

export function AppFontVars() {
  return <style dangerouslySetInnerHTML={{ __html: FONT_VARS }} />;
}
