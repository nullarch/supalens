// Operator business details for the hosted service. Korean commerce law
// requires these disclosures in the footer, so they are preserved in the
// (muted) legal strip even though the slab is otherwise minimal.
// `ceo` is the one locale-varying field (romanization) — it comes from
// `footer.biz.ceoName` in the message catalog, not this constant.
export const COMPANY = {
  name: "Streamize Co., Ltd.",
  registrationNumber: "677-87-02793",
  email: "admin@supalens.ai",
};

// Link destinations, merged by index with the localized labels in the catalog.
// NOTE: only link destinations that actually exist — no `href="#"` placeholders.
// 문서/블로그/상태 pages come back here when they ship.
export const COLUMN_HREFS: string[][] = [
  ["#how", "#why-code", "#monitoring", "#security", "#pricing"],
  ["/supabase"],
  ["/demo", "/docs/mcp"],
  ["mailto:admin@supalens.ai"],
  ["/privacy", "/terms", "/refund"],
];

export type CatalogColumn = { title: string; links: string[] };

// External destinations get a "↗" suffix (per the design system).
export function isExternal(href: string): boolean {
  return href.startsWith("http") || href.startsWith("mailto:");
}
