import { CONNECT_HREF } from "./headers/shared";

// Non-text plan attributes (proper-noun name, numeric price, href, featured).
// Text (tagline/intro/per/features/cta) comes from the catalog, merged by index.
// Feature rows (catalog) are ordered by the operator value units — monitors →
// check cadence → alert channel → data sources → team → questions (fair use) —
// and their numbers mirror PLAN_LIMITS (src/lib/plans/limits.ts): alerts_per_org
// 3/10/50/∞, alert_min_check_interval 2h/10m/5m/5m (1-minute is NOT promised).
// The alert-channel row reads the same on every tier because notification
// channels are NOT plan-gated in code (nothing in connect-slack or notify/*
// checks a plan) — if that ever changes, build the gate before splitting the row.
// Free lands on the Supabase connect step; paid tiers carry the plan intent
// into the billing page so the choice survives the login round-trip.
const billingHref = (plan: string) =>
  `/login?next=${encodeURIComponent(`/app/settings/billing?plan=${plan}`)}`;
export const PLAN_META: { name: string; price: string; href: string; featured?: boolean }[] = [
  { name: "Free", price: "$0", href: CONNECT_HREF },
  { name: "Basic", price: "$89", href: billingHref("basic"), featured: true },
  { name: "Standard", price: "$299", href: billingHref("standard") },
  { name: "Premium", price: "$899", href: billingHref("premium") },
];

export type PlanText = {
  per: string;
  tagline: string;
  intro: string;
  features: string[];
  cta: string;
};
