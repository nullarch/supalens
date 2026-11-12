/* ============================================================
   headers/shared.ts — the ONE source of truth for the site-nav
   link data, so header variants don't each re-declare the same
   hrefs. No React here — plain data.
   ============================================================ */

// `labelKey` indexes into the `nav` i18n namespace (resolved at render
// time via t(l.labelKey)) — shared.ts is plain data, so no t() here.
export type NavLink = { labelKey: string; href: string };

// Operator-first nav (2026-09): the anchors follow the landing's section
// order — how it works → why code → monitoring → security → pricing.
// MCP + Features left the nav (MCP docs live in the footer Resources column).
// `/demo` is a real route (the no-signup live demo), not a landing anchor.
export const NAV_LINKS: NavLink[] = [
  { labelKey: "howItWorks", href: "#how" },
  { labelKey: "monitoring", href: "#monitoring" },
  { labelKey: "security", href: "#security" },
  { labelKey: "pricing", href: "#pricing" },
  { labelKey: "liveDemo", href: "/demo" },
];

export const LOGIN_HREF = "/login";

// Primary CTA ("Connect Supabase"): the label promises a Supabase connection,
// so the post-login landing must BE the connect step — /app/sources opens its
// connect modal focused on Supabase when `?connect=supabase` is present.
// (The `next` value is URL-encoded once; /login's safeNext accepts query strings.)
export const CONNECT_HREF = "/login?next=%2Fapp%2Fsources%3Fconnect%3Dsupabase";
export const START_HREF = CONNECT_HREF;
export const DASHBOARD_HREF = "/app";
