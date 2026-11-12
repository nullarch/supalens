import { DM_Mono, DM_Sans, Noto_Serif_JP, Noto_Serif_KR } from "next/font/google";

/* Self-hosted by next/font and scoped to the editorial home page.
   Latin headings use the Iowan/Georgia stack (no web font, as in the
   reference). The CJK serifs are never preloaded; the browser fetches only
   the unicode-range slices a Korean or Japanese heading actually uses. */
const sans = DM_Sans({ subsets: ["latin"], variable: "--ed-font-sans", display: "swap" });
const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--ed-font-mono",
  display: "swap",
});
const serifKo = Noto_Serif_KR({
  weight: "400",
  variable: "--ed-font-serif-ko",
  display: "swap",
  preload: false,
});
const serifJa = Noto_Serif_JP({
  weight: "400",
  variable: "--ed-font-serif-ja",
  display: "swap",
  preload: false,
});

export const editorialFontVariables = [sans.variable, mono.variable, serifKo.variable, serifJa.variable].join(" ");
