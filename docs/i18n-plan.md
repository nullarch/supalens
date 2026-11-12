# Internationalization (i18n) Plan

**Goal:** English becomes the primary language; Korean and Japanese are secondary. Today the
product is Korean-first end to end — landing (`<html lang="ko">`), the entire `/app` surface, and
server-side strings (agent prompts, emails, quota messages, `toLocaleString('ko-KR')`). This plan
takes it to `en` (default) + `ko` + `ja`.

## Locked decisions

| Decision | Choice | Consequence |
|----------|--------|-------------|
| Library | **next-intl** | The App Router standard; server-component + middleware + metadata support. |
| Routing | **Hybrid** | Marketing is path-routed (`/`, `/ko`, `/ja`) for SEO. `/app` picks locale from a **cookie + user setting** — no `/app/ko/...`, no rewriting the 57 internal `/app` links. |
| Rollout | **Phased** | P1 landing (ship) → P2 `/app` UI → P3 server-side (emails, LLM output language, formatting, hreflang). Each ships independently. |
| JA quality | **Machine draft, flagged** | I produce EN (high confidence) + JA drafts from the Korean source; JA strings are marked `needs-review` for a native pass before leaning on the JP market. KO is the source of truth. |
| Default locale | **`en`**, unprefixed | `localePrefix: 'as-needed'` → `/` = English, `/ko` + `/ja` prefixed. |

## Translation content model — three buckets (do NOT treat them the same)

1. **UI strings** → message catalogs `messages/{en,ko,ja}.json`. The bulk. ~17 landing files +
   ~28 `/app` files. Extracted from JSX, keyed, translated. **This is the only bucket that is a
   "catalog".**
2. **LLM-facing strings** → **NOT catalog work.** Agent system prompts are Korean today; the fix is
   to keep the prompt scaffolding **English/stable** and inject *"respond to the user in {locale}"* as
   a parameter. MCP tool names/descriptions stay **English** (developer-facing in Claude Desktop).
   Translating prompt scaffolding into KO/JA is a correctness regression — don't.
3. **Server-side operational strings** → localized to the **recipient's** locale, which has no request
   context, so locale must be **stored** (user/org row). Emails (alert/invite), quota/limit messages
   (`usage.ts`, `limits.ts`), and `Intl` number/date/currency formatting.

**Keep English, never translate:** API contracts, DB enum values, log lines, MCP tool names, code.

---

## Phase 1 — Infra + landing (ship first, lowest risk, highest visibility)

Landing is almost all server components (only `Faq` is `"use client"`), so this is clean.

### Infra
- `npm i next-intl`.
- `src/i18n/routing.ts` — `defineRouting({ locales:['en','ko','ja'], defaultLocale:'en', localePrefix:'as-needed' })`.
- `src/i18n/request.ts` — `getRequestConfig` **unified resolver**: use the `[locale]` segment when
  present (marketing); otherwise fall back to the `NEXT_LOCALE` cookie (this is what makes `/app`
  cookie-driven in P2 with the same resolver). Loads `messages/${locale}.json`.
- `messages/{en,ko,ja}.json` created.
- **Route move:** SEO-indexed marketing pages → `src/app/[locale]/`:
  `page.tsx` (landing), `privacy/`, `terms/`, `refund/`.
  - **`login/` stays at `/login` (NOT moved).** It is `robots: noindex` (no SEO path-routing need),
    and it is auth-critical: the middleware's `/app`→`/login` redirect + the `?next=` flow rely on a
    stable unprefixed path. It still localizes — as a non-`[locale]` route it resolves locale from the
    `NEXT_LOCALE` cookie via the unified `getRequestConfig`, exactly the P2 `/app` mechanism.
  - Next.js resolves the static `app/` segment before the dynamic `[locale]`, so **`/app/*` still
    routes to `src/app/app` unaffected.** `[locale]` only ever captures `/ko`, `/ja`, etc.
  - **`<html>` stays in the SINGLE root `layout.tsx` — do NOT render `<html>` in
    `[locale]/layout.tsx`.** In App Router only the root layout renders `<html>`/`<body>`; a nested
    `[locale]/layout.tsx` that also rendered `<html>` would produce invalid nested `<html>`, and
    moving `<html>` *into* `[locale]` would strip `/app`, `/api`, `/auth`, `/dev`, `/share`, `/test`
    of their html + providers (they live OUTSIDE `[locale]`). Instead the root layout becomes
    `async` and sets `<html lang={await getLocale()}>` (next-intl server `getLocale()` — resolves
    via the same unified resolver: path segment for marketing, `NEXT_LOCALE` cookie for `/app`), and
    wraps children in `NextIntlClientProvider`. This is *more* unified than a per-`[locale]` html:
    `/app` gets the correct `lang` for free in P2 with zero extra wiring.
  - `[locale]/layout.tsx` is a **pass-through** (no `<html>`): it only calls `setRequestLocale(locale)`
    (see static-rendering note below) and exports `generateStaticParams` for `['en','ko','ja']`.
- **Middleware composition (the main technical risk):** chain next-intl's middleware with the
  existing Supabase `updateSession`. Apply the **intl** middleware only to marketing paths
  (`/`, `/(ko|ja)/:path*`, `/(privacy|terms|refund|login)`); keep `updateSession` for the rest. Both
  mutate the response — run intl first, then let Supabase set cookies on the returned response. Test
  redirects + session refresh together; this is where subtle bugs live.
- `LanguageSwitcher` component — marketing variant navigates via next-intl `useRouter`/`usePathname`
  (prefix-aware) **and** writes `NEXT_LOCALE` so the choice carries into `/app`.

- **Static rendering (do NOT skip — SEO is the point of P1):** `[locale]` + next-intl makes marketing
  pages dynamic unless each page/layout calls `setRequestLocale(locale)` at the top AND `[locale]/layout.tsx`
  exports `generateStaticParams`. Without this the landing loses SSG.
- **Root `metadata` neutralized:** the root `layout.tsx` currently hardcodes a Korean `title`/`description`.
  Move localized marketing metadata into `[locale]` via `generateMetadata`; strip the root `metadata`
  to a locale-neutral fallback (it otherwise leaks Korean into `/app` `<title>`).

### Content (P1)
- Extract Korean from the 13 landing components (`src/components/landing/*.tsx` — note `Faq` **and**
  `Showcase` are `"use client"`) + 4 marketing pages into keys; author EN (canonical) + JA draft; move
  existing KO into the catalog. Enumerate the real surface first with
  `grep -rP '[\x{AC00}-\x{D7A3}]' src/components/landing src/app/{privacy,terms,refund,login}` — it will
  surface more than the visible copy (aria-labels, alt text, metadata).
- Per-locale metadata: `generateMetadata` reads `[locale]` → localized `<title>`/`description`.
- Add hreflang alternates for `/`, `/ko`, `/ja` (can be minimal here, full sitemap in P3).

**Exit:** public face is English-main with working `/ko` `/ja`; `/app` untouched (still Korean).

### ✅ P1 status — BUILT & verified (2026-07-08)

Infra + full landing/legal localization shipped. Verified at runtime (`npm run build` green,
`npm test` 130 pass):
- `/` → English, `/ko` → Korean, `/ja` → Japanese; `<html lang>` correct per locale; `/en` 307→`/`.
- Localized `<title>` per locale (landing + legal); hreflang alternates on the landing.
- Middleware composition holds: `/app` still auth-redirects to `/login`, session refresh intact,
  and the `NEXT_LOCALE` cookie already drives locale on non-`[locale]` routes (`/login?lang=ja`
  renders `lang="ja"`) — the P2 mechanism is live.
- Catalogs: `messages/{en,ko,ja}.json`, 18 namespaces (nav, common, meta, hero, stats, steps,
  mcpHub, features, alertDemo, showcase, pricing, faq, finalCta, footer, legal, privacy, terms,
  refund). KO = source of truth, EN canonical, **JA = machine draft (needs a native pass)**.
- `LanguageSwitcher` in the landing header (prefix-aware nav + cookie write).

Known small follow-ups (not blockers): the footer representative name is a proper noun kept as-is across
locales; JA strings await a native review before the JP go-to-market.

---

## Phase 2 — `/app` product UI

- **Locale source:** `NEXT_LOCALE` cookie (already resolved by the P1 `getRequestConfig` fallback).
  No route move, no `[locale]` under `/app`. Add an in-app language setting
  (`/app/settings`) that writes the cookie; optionally persist to a user-preferences row (needed
  anyway for P3 emails).
- Translate the ~28 `/app/*.tsx` files: `ask`, `sources`, `dashboards`, `alerts`, `mcp`, `settings`
  (+ billing/members/integrations), plus shared `src/components/**` product chrome.
- `AppChrome`/sidebar, onboarding checklist, KPI/dashboard/alert UI strings → catalog.
- `LanguageSwitcher` (app variant) in the app chrome — cookie write + `router.refresh()`.

**Exit:** signed-in product renders in the user's chosen locale.

### ✅ P2 status — BUILT & verified (2026-07-08)

~48 production `/app` files localized across 14 `app*` namespaces (dev-only ChromeV1–10 and the
Slack-concurrent `integrations/page.tsx`/`actions.ts` deliberately skipped). Verified: `npm run build`
green, `npm test` 139 pass, login form + all namespaces resolve per `NEXT_LOCALE` cookie, no
MISSING_MESSAGE at runtime. App `LanguageSwitcher` (variant `app`: cookie write + `router.refresh()` +
best-effort `setUserLocale` → `profiles.locale`) wired into the sidebar. DangerZone account-delete
keyword is now locale-aware (`DELETE`/`탈퇴`/`削除`) so non-Korean users aren't forced to type Korean.

---

## Phase 3 — Server-side, formatting, SEO

- **Stored locale:** add `locale` to the user profile (and/or org). Source of truth for anything
  without a request (emails, cron-driven alerts).
- **Emails** (`src/lib/email/*`, alert/invite) → localized to recipient's stored locale. Keep the
  "never throw" contract intact. **Runtime caveat:** emails send from the **Trigger.dev host**
  (`alerts/runner.ts` → `email/alert.ts`), which has NO Next.js request context — next-intl's
  request-scoped APIs (`getTranslations`) do NOT work there. Localize by importing `messages/${locale}.json`
  directly + `createTranslator` (or plain `Intl`), same "shared-with-Trigger, no `server-only`" rule that
  already governs these modules.
- **Quota / limit messages** (`src/lib/plans/usage.ts`, `limits.ts`) → catalog + locale-aware
  `Intl.NumberFormat` instead of hardcoded `ko-KR`. **DONE (2026-07-16):** the `quota` namespace +
  `getServerTranslator`; `checkUsageQuota`/`enforceResourceLimit`/`enforceSeatLimit`/
  `enforceInviteRateLimit` take the requester's locale (BFF `getLocale()`, MCP user locale, en default).
- **Formatting** (`src/lib/viz/format.ts` `formatValue`, currently `ko-KR`) → locale-driven via
  next-intl `useFormatter` / `Intl`. Affects widget output (product + agent results).
- **Agent output language:** inject "respond in {userLocale}" into the run system prompt
  (`run-analysis.ts`, `run-firestore-analysis.ts`, `run-code-analysis.ts`). Prompt scaffolding stays
  English. Locale comes from the run's originating user.
- **SEO polish:** full hreflang + `sitemap.ts` covering en/ko/ja marketing routes; `robots`.

**Exit:** fully localized including notifications and AI output; SEO complete.

### ◑ P3 status — mostly BUILT & verified (2026-07-08)

DONE (code-complete, build green, verified):
- **Stored locale:** `profiles.locale` (migration `20260708033606_profiles_locale.sql`; CHECK en|ko|ja,
  nullable) + `setUserLocale` server action (self-update via `prof_upd` RLS). Read via
  `src/lib/i18n/resolve-locale.ts` (`resolveUserLocale`, `resolveOrgLocale` — owner's locale for
  org-wide cron sends). All best-effort: a missing/unmigrated column degrades to `en`, never throws.
- **Emails** (`src/lib/email/{alert,invite,billing,digest,welcome}.ts`) → all send fns take `locale?`,
  render subject+body via `getServerTranslator` (request-free `createTranslator`, static JSON imports so
  esbuild bundles them on the Trigger host). 5 `email*` namespaces. Every call site wired to the
  recipient/org locale (runner, explain, invite=request, welcome=request, digest, paddle dunning, quota
  warning). The alert `describe()`/`describeAnomaly()` bodies are localized too (org locale) so email +
  Slack + `/app/alerts` stay consistent. Verified rendering in en/ko/ja.
- **Agent output language:** `src/lib/i18n/agent-locale.ts::languageDirective` appended to the system
  prompt of all three runners (`run-analysis`, `run-firestore-analysis`, `run-code-analysis`); prompt
  scaffolding stays English. Locale threaded: BFF `/api/agent/analyze` (`getLocale`), local SSE route,
  MCP `ask` (`resolveUserLocale`), + explain-alert and weekly-digest system runs (org locale). Trigger
  payloads (`analyze`/`analyze-firestore`/`analyze-code`) carry `locale`.
- **SEO:** `src/app/sitemap.ts` (en/ko/ja alternates) + `src/app/robots.ts`; landing `generateMetadata`
  hreflang (P1).

DEFERRED (documented, low-risk):
- `src/lib/viz/format.ts` `LOCALE='ko-KR'` → locale-driven: invasive threading through every
  `formatValue` call; number grouping en-US/ko-KR is near-identical, so low visible impact. Scattered
  `toLocaleString('ko-KR')` (McpClient, sidebar plan meter, SourcesClient/sources relativeTime, email
  `fmt`) fold into this.
- Paddle checkout `locale: 'ko'` (CheckoutButton) → user locale.
- `extract-kpis` / `generate-context` output language (KPI titles / SUPALENS.md — context is a TRUSTED
  English doc by design; KPI titles a possible follow-up).

---

## Risks / gotchas (named honestly)

- **Middleware chain** (next-intl × Supabase `updateSession`) is the #1 fragile point — both write
  the response. Needs deliberate testing of login redirect + session refresh on marketing routes.
- **`[locale]` vs `/app` collision** — relies on Next.js static-over-dynamic priority. Verify `/app`,
  `/api`, `/auth`, `/dev`, `/test`, `/share`, `/logos`, `.well-known` are all excluded from the intl matcher.
- **JA quality** — machine drafts are for wiring, not for the JP go-to-market. Flag before relying on it.
- **Don't over-translate** — prompt scaffolding, MCP tool names, logs, enums stay English (regression risk).
- **Number/currency** — pricing is already USD ($89/$299/$899), so no currency conversion needed; only
  formatting locale changes.

## Non-goals (v1)
- Locale-in-URL for `/app` (cookie is enough behind auth).
- Machine-perfect JA (explicitly deferred to a review pass).
- RTL, additional locales.

## Rough effort
Infra ~0.5d · landing translate/review ~1–2d · `/app` UI ~2–3d · server/LLM/SEO ~1–2d.
**~1.5–2 focused weeks**, but Phase 1 delivers the visible English-main win in the first ~2–3 days.
